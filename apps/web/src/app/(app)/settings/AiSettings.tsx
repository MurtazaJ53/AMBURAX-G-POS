"use client";

import { useActionState, useRef, useEffect } from "react";
import { Sparkles, Bot, Cpu } from "lucide-react";
import { buttonClass, Card, CardHeader } from "../_components/ui";
import { saveAiKeyAction, saveGeminiKeyAction, saveOpenAiKeyAction, type AiKeyState } from "./aiActions";

const IDLE: AiKeyState = { status: "idle" };

/**
 * AI Provider Settings (Google Gemini, OpenAI ChatGPT & Anthropic Claude)
 *
 * Merchants can supply either their Gemini, ChatGPT, or Claude key.
 * Keys are AES-256-GCM encrypted and only the last 4 digits are revealed.
 */
export function AiSettings({
  set,
  last4,
  geminiSet,
  geminiLast4,
  openaiSet,
  openaiLast4,
  storageReady,
}: {
  set: boolean;
  last4: string | null;
  geminiSet: boolean;
  geminiLast4: string | null;
  openaiSet: boolean;
  openaiLast4: string | null;
  storageReady: boolean;
}) {
  const [geminiState, geminiAction, geminiPending] = useActionState(saveGeminiKeyAction, IDLE);
  const [openaiState, openaiAction, openaiPending] = useActionState(saveOpenAiKeyAction, IDLE);
  const [claudeState, claudeAction, claudePending] = useActionState(saveAiKeyAction, IDLE);

  const geminiForm = useRef<HTMLFormElement>(null);
  const openaiForm = useRef<HTMLFormElement>(null);
  const claudeForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (geminiState.status === "success") geminiForm.current?.reset();
  }, [geminiState]);

  useEffect(() => {
    if (openaiState.status === "success") openaiForm.current?.reset();
  }, [openaiState]);

  useEffect(() => {
    if (claudeState.status === "success") claudeForm.current?.reset();
  }, [claudeState]);

  return (
    <div className="space-y-4">
      {/* 1. Google Gemini Key Setup */}
      <Card>
        <CardHeader
          title="Google Gemini AI (Recommended)"
          subtitle={
            geminiSet
              ? `Active (Key ending …${geminiLast4}). Used for high-speed bill OCR, smart catalog import, and POS insights.`
              : "Connect your Google Gemini API key (@google/genai, gemini-2.5-flash) for instant supplier bill reading and smart import."
          }
        />
        <form ref={geminiForm} action={geminiAction} className="space-y-3.5 px-5 pb-5" autoComplete="off">
          {!storageReady && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              The server needs an encryption key configured before API keys can be securely stored.
            </p>
          )}

          <label className="block text-sm font-medium text-slate-700">
            Google Gemini API Key
            <input
              name="geminiKey"
              type="password"
              placeholder={geminiSet ? `…${geminiLast4} (paste new key to replace)` : "AIzaSy…"}
              className="amb-focus mt-1 block min-h-11 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Generate from Google AI Studio (aistudio.google.com → Get API key).
            </span>
          </label>

          {geminiState.status !== "idle" && (
            <p
              role={geminiState.status === "error" ? "alert" : "status"}
              className={`text-xs font-medium ${geminiState.status === "error" ? "text-rose-700" : "text-emerald-800"}`}
            >
              {geminiState.message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={geminiPending || !storageReady}
              className={`${buttonClass("primary")} amb-press !py-2 !px-4 !text-xs`}
            >
              <Bot aria-hidden="true" className="h-4 w-4" />
              {geminiPending ? "Saving…" : geminiSet ? "Replace Gemini Key" : "Save Gemini Key"}
            </button>
            {geminiSet && (
              <button
                type="submit"
                name="remove"
                value="yes"
                disabled={geminiPending}
                className={`${buttonClass("secondary")} !py-2 !px-3 !text-xs`}
              >
                Remove
              </button>
            )}
          </div>
        </form>
      </Card>

      {/* 2. OpenAI ChatGPT Key Setup */}
      <Card>
        <CardHeader
          title="OpenAI ChatGPT AI (GPT-4o / GPT-4o-mini)"
          subtitle={
            openaiSet
              ? `Active (Key ending …${openaiLast4}). Used for bill OCR, catalog imports, and store intelligence.`
              : "Connect your OpenAI ChatGPT API key (sk-…) to enable GPT-4o powered intelligence across your store."
          }
        />
        <form ref={openaiForm} action={openaiAction} className="space-y-3.5 px-5 pb-5" autoComplete="off">
          <label className="block text-sm font-medium text-slate-700">
            OpenAI API Key
            <input
              name="openaiKey"
              type="password"
              placeholder={openaiSet ? `…${openaiLast4} (paste new key to replace)` : "sk-…"}
              className="amb-focus mt-1 block min-h-11 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Generate from platform.openai.com → API keys.
            </span>
          </label>

          {openaiState.status !== "idle" && (
            <p
              role={openaiState.status === "error" ? "alert" : "status"}
              className={`text-xs font-medium ${openaiState.status === "error" ? "text-rose-700" : "text-emerald-800"}`}
            >
              {openaiState.message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={openaiPending || !storageReady}
              className={`${buttonClass("secondary")} amb-press !py-2 !px-4 !text-xs`}
            >
              <Cpu aria-hidden="true" className="h-4 w-4" />
              {openaiPending ? "Saving…" : openaiSet ? "Replace ChatGPT Key" : "Save ChatGPT Key"}
            </button>
            {openaiSet && (
              <button
                type="submit"
                name="remove"
                value="yes"
                disabled={openaiPending}
                className={`${buttonClass("secondary")} !py-2 !px-3 !text-xs`}
              >
                Remove
              </button>
            )}
          </div>
        </form>
      </Card>

      {/* 3. Anthropic Claude Key Setup */}
      <Card>
        <CardHeader
          title="Anthropic Claude AI (Alternative)"
          subtitle={
            set
              ? `Configured (Key ending …${last4}). Used for bill parsing when Gemini is not active.`
              : "Optionally provide an Anthropic API key (sk-ant-…) for Claude Sonnet bill parsing."
          }
        />
        <form ref={claudeForm} action={claudeAction} className="space-y-3.5 px-5 pb-5" autoComplete="off">
          <label className="block text-sm font-medium text-slate-700">
            Anthropic API Key
            <input
              name="apiKey"
              type="password"
              placeholder={set ? `…${last4} (paste new key to replace)` : "sk-ant-…"}
              className="amb-focus mt-1 block min-h-11 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Obtain from console.anthropic.com → API keys.
            </span>
          </label>

          {claudeState.status !== "idle" && (
            <p
              role={claudeState.status === "error" ? "alert" : "status"}
              className={`text-xs font-medium ${claudeState.status === "error" ? "text-rose-700" : "text-emerald-800"}`}
            >
              {claudeState.message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={claudePending || !storageReady}
              className={`${buttonClass("secondary")} amb-press !py-2 !px-4 !text-xs`}
            >
              <Sparkles aria-hidden="true" className="h-4 w-4" />
              {claudePending ? "Saving…" : set ? "Replace Claude Key" : "Save Claude Key"}
            </button>
            {set && (
              <button
                type="submit"
                name="remove"
                value="yes"
                disabled={claudePending}
                className={`${buttonClass("secondary")} !py-2 !px-3 !text-xs`}
              >
                Remove
              </button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}

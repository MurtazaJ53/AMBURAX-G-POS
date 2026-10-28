"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, LogOut, User, Settings as SettingsIcon } from "lucide-react";

interface UserMenuProps {
  userName: string;
  roleLabel: string;
}

export function UserMenu({ userName, roleLabel }: UserMenuProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/auth/login");
    router.refresh();
  }

  const initials = userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || userName.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Account menu, ${userName}`} className="flex items-center gap-2 rounded-md p-1 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-white"
        >
          {initials}
        </span>
        <span className="hidden text-left lg:block">
          <b className="block text-[10px] text-slate-700">{userName}</b>
          <small className="text-[9px] text-slate-400 leading-none">{roleLabel}</small>
        </span>
        <ChevronDown className="hidden size-3 text-slate-400 lg:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block text-sm font-medium text-slate-800">{userName}</span>
          <span className="block text-xs text-slate-500 font-normal">{roleLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <User className="mr-2 h-4 w-4" />
          <span>Profile</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/settings/security")}>
          <SettingsIcon className="mr-2 h-4 w-4" />
          <span>Security &amp; sign-in</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} disabled={signingOut} className="text-rose-600 focus:bg-rose-50 focus:text-rose-700">
          <LogOut className="mr-2 h-4 w-4" />
          <span>{signingOut ? "Signing out..." : "Sign out"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

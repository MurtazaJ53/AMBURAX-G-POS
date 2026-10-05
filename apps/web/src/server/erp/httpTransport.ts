import type { ErpCredentials } from "@/server/erp/config";
import type { ErpRequest, ErpResponse, ErpTransport } from "@/server/erp/transport";
import { ErpTransportError } from "@/server/erp/transport";

export class HttpErpTransport implements ErpTransport {
  async send(request: ErpRequest, credentials: ErpCredentials): Promise<ErpResponse> {
    const url = new URL(request.path, credentials.baseUrl);
    
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Authorization": `token ${credentials.apiKey}:${credentials.apiSecret}`,
      "X-Correlation-Id": request.correlationId,
    };
    
    if (request.idempotencyKey) {
      headers["X-Idempotency-Key"] = request.idempotencyKey;
    }

    if (request.body) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: request.method,
        headers,
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let body: unknown = {};
      try {
        if (text) body = JSON.parse(text);
      } catch (e) {
        throw new ErpTransportError("malformed", "Invalid JSON response");
      }

      return {
        status: response.status,
        body,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new ErpTransportError("timeout", `Request timed out after ${request.timeoutMs}ms`);
      }
      if (err instanceof ErpTransportError) {
        throw err;
      }
      throw new ErpTransportError("connection", "Connection failed");
    } finally {
      clearTimeout(timer);
    }
  }
}

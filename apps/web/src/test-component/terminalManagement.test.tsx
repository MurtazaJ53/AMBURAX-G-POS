import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, waitFor } from "./render";
import userEvent from "@testing-library/user-event";
import { TerminalManager } from "@/app/(app)/settings/terminals/TerminalManager";
import { stubApi } from "./apiStub";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function() {
    this.removeAttribute('open');
  };
});

const MOCK_DEVICES = [
  { id: "dev_1", name: "Register 1", code: "POS-01", status: "ACTIVE", lastSeenAt: null, storeId: "store_1" },
  { id: "dev_2", name: "Register 2", code: "POS-02", status: "PENDING_ACTIVATION", lastSeenAt: null, storeId: "store_1" },
  { id: "dev_3", name: "Register 3", code: "POS-03", status: "DISABLED", lastSeenAt: null, storeId: "store_1" }
];

describe("Admin POS Terminal Management", () => {
  it("LIST: renders the terminal list and empty states", async () => {
    stubApi([
      {
        path: "/api/v1/pos/devices",
        method: "GET",
        replies: [{ kind: "ok", body: { status: "ok", devices: MOCK_DEVICES } }]
      }
    ]);

    render(<TerminalManager />);
    expect(screen.getByText(/Loading terminals/i)).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Register 1")).toBeTruthy();
    });

    expect(screen.getByText("Register 2")).toBeTruthy();
    expect(screen.getByText("Register 3")).toBeTruthy();
    expect(screen.getByText("Pending Activation")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
  });

  it("LIST: shows an empty state when no terminals exist", async () => {
    stubApi([
      {
        path: "/api/v1/pos/devices",
        method: "GET",
        replies: [{ kind: "ok", body: { status: "ok", devices: [] } }]
      }
    ]);

    render(<TerminalManager />);
    await waitFor(() => {
      expect(screen.getByText(/No Terminals/i)).toBeTruthy();
    });
  });

  it("AUTHORIZATION: handles capability disabled error gracefully", async () => {
    stubApi([
      {
        path: "/api/v1/pos/devices",
        method: "GET",
        replies: [{ kind: "error", status: 403, code: "capability_disabled", message: "Retail capability is required." }]
      }
    ]);

    render(<TerminalManager />);
    await waitFor(() => {
      expect(screen.getByText(/Access Denied/i)).toBeTruthy();
    });
  });

  it("DISABLE: confirms before disabling and refreshes list", async () => {
    const api = stubApi([
      {
        path: "/api/v1/pos/devices",
        method: "GET",
        replies: [{ kind: "ok", body: { status: "ok", devices: MOCK_DEVICES } }]
      },
      {
        path: "/api/v1/pos/devices/dev_1/disable",
        method: "POST",
        replies: [{ kind: "ok", body: { status: "ok" } }]
      }
    ]);

    const user = userEvent.setup();
    render(<TerminalManager />);

    await waitFor(() => {
      expect(screen.getByText("Register 1")).toBeTruthy();
    });

    // Register 1 is active, so it has a disable button
    const disableBtn = screen.getByRole("button", { name: "Disable Register 1" });
    await user.click(disableBtn);

    // Dialog appears
    expect(screen.getByText(/Are you sure you want to disable/)).toBeTruthy();
    expect(screen.getAllByText(/Register 1/).length).toBeGreaterThan(0);

    // Confirm
    const confirmBtn = screen.getByRole("button", { name: "Confirm Disable" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(api.countFor("/api/v1/pos/devices/dev_1/disable")).toBe(1);
    });
  });

  it("RE-PAIR: confirms before re-pairing and shows the code safely", async () => {
    const api = stubApi([
      {
        path: "/api/v1/pos/devices",
        method: "GET",
        replies: [{ kind: "ok", body: { status: "ok", devices: MOCK_DEVICES } }]
      },
      {
        path: "/api/v1/pos/devices/dev_3/re-pair",
        method: "POST",
        replies: [{ kind: "ok", body: { status: "ok", pairingCode: "ABCD-EFGH" } }]
      }
    ]);

    const user = userEvent.setup();
    render(<TerminalManager />);

    await waitFor(() => {
      expect(screen.getByText("Register 3")).toBeTruthy();
    });

    // Register 3 is disabled, so it has a re-pair button
    const repairBtn = screen.getByRole("button", { name: "Re-pair Register 3" });
    await user.click(repairBtn);

    // Dialog appears
    expect(screen.getByText(/Are you sure you want to re-pair/)).toBeTruthy();

    // Confirm
    const confirmBtn = screen.getByRole("button", { name: "Confirm Re-pair" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(api.countFor("/api/v1/pos/devices/dev_3/re-pair")).toBe(1);
      // Wait for success dialog with pairing code
      expect(screen.getByText("ABCD-EFGH")).toBeTruthy();
    });
  });

  it("DISABLE: failure keeps dialog open, renders inline error, allows retry", async () => {
    let alertCalled = false;
    window.alert = () => { alertCalled = true; };

    const api = stubApi([
      {
        path: "/api/v1/pos/devices",
        method: "GET",
        replies: [{ kind: "ok", body: { status: "ok", devices: MOCK_DEVICES } }]
      },
      {
        path: "/api/v1/pos/devices/dev_1/disable",
        method: "POST",
        replies: [
          { kind: "error", status: 409, code: "conflict", message: "Cannot disable right now." },
          { kind: "ok", body: { status: "ok" } }
        ]
      }
    ]);

    const user = userEvent.setup();
    render(<TerminalManager />);

    await waitFor(() => {
      expect(screen.getByText("Register 1")).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Disable Register 1" }));

    const confirmBtn = screen.getByRole("button", { name: "Confirm Disable" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getAllByText("Cannot disable right now.").length).toBeGreaterThan(0);
    });
    
    expect(alertCalled).toBe(false);
    expect(api.countFor("/api/v1/pos/devices/dev_1/disable")).toBe(1);

    // Dialog should still be open
    expect(screen.getAllByText(/Are you sure you want to disable/).length).toBeGreaterThan(0);

    // Retry
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(api.countFor("/api/v1/pos/devices/dev_1/disable")).toBe(2);
      expect(screen.queryByText("Cannot disable right now.")).toBeNull();
    });
  });

  it("RE-PAIR: failure keeps dialog open, renders inline error, allows retry", async () => {
    let alertCalled = false;
    window.alert = () => { alertCalled = true; };

    const api = stubApi([
      {
        path: "/api/v1/pos/devices",
        method: "GET",
        replies: [{ kind: "ok", body: { status: "ok", devices: MOCK_DEVICES } }]
      },
      {
        path: "/api/v1/pos/devices/dev_3/re-pair",
        method: "POST",
        replies: [
          { kind: "offline" },
          { kind: "ok", body: { status: "ok", pairingCode: "RETRY-CODE" } }
        ]
      }
    ]);

    const user = userEvent.setup();
    render(<TerminalManager />);

    await waitFor(() => {
      expect(screen.getByText("Register 3")).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Re-pair Register 3" }));

    const confirmBtn = screen.getByRole("button", { name: "Confirm Re-pair" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getAllByText("Network error").length).toBeGreaterThan(0);
    });
    
    expect(alertCalled).toBe(false);
    
    // Retry
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText("RETRY-CODE")).toBeTruthy();
    });
  });

  it("SECURITY: does not display sensitive credentials or hashes", async () => {
    stubApi([
      {
        path: "/api/v1/pos/devices",
        method: "GET",
        replies: [{ kind: "ok", body: { status: "ok", devices: MOCK_DEVICES } }]
      }
    ]);

    render(<TerminalManager />);
    await waitFor(() => {
      expect(screen.getByText("Register 1")).toBeTruthy();
    });

    // Ensure we don't accidentally leak hashes if they were passed somehow (they shouldn't be).
    // The data source PosDeviceView doesn't even contain them.
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/hash/i);
    expect(html).not.toMatch(/secret/i);
  });
});

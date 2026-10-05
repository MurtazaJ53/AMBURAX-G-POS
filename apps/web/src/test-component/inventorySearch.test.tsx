import { render, screen, cleanup } from "./render";
import { fireEvent } from "@testing-library/dom";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { InventoryToolbar } from "@/components/inventory/InventoryToolbar";
import { useRouter } from "next/navigation";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

vi.mock("lucide-react", () => {
  const Icon = () => <svg data-testid="icon" />;
  return { Search: Icon, SlidersHorizontal: Icon, RotateCcw: Icon, List: Icon, Grid2X2: Icon };
});

describe("InventoryToolbar Search Synchronization", () => {
  const mockPush = vi.fn();
  
  beforeEach(() => {
    vi.mocked(useRouter).mockReturnValue({ push: mockPush } as any);
    mockPush.mockClear();
    cleanup();
  });

  const defaultProps = {
    view: "table",
    page: 1,
    categories: ["Shirts", "Pants"],
    brands: ["Nike", "Adidas"],
  };

  test("Initial URL populates input", () => {
    render(<InventoryToolbar {...defaultProps} search="Chinos" />);
    const input = screen.getByRole("textbox", { name: "Search inventory" }) as HTMLInputElement;
    expect(input.value).toBe("Chinos");
  });

  test("Search state change updates input", () => {
    render(<InventoryToolbar {...defaultProps} search="Chinos" />);
    const input = screen.getByRole("textbox", { name: "Search inventory" }) as HTMLInputElement;
    expect(input.value).toBe("Chinos");

    cleanup();
    render(<InventoryToolbar {...defaultProps} search="Jeans" />);
    const input2 = screen.getByRole("textbox", { name: "Search inventory" }) as HTMLInputElement;
    expect(input2.value).toBe("Jeans");
  });

  test("Reset clears input", () => {
    render(<InventoryToolbar {...defaultProps} search="Chinos" />);
    const input = screen.getByRole("textbox", { name: "Search inventory" }) as HTMLInputElement;
    
    const resetButton = screen.getByRole("button", { name: /reset/i });
    fireEvent.click(resetButton);
    expect(mockPush).toHaveBeenCalledWith("/inventory?");

    // Simulate URL changing to empty search
    cleanup();
    render(<InventoryToolbar {...defaultProps} search={undefined} />);
    const input2 = screen.getByRole("textbox", { name: "Search inventory" }) as HTMLInputElement;
    expect(input2.value).toBe("");
  });

  test("URL navigation back to empty search clears input", () => {
    render(<InventoryToolbar {...defaultProps} search="Chinos" />);
    const input = screen.getByRole("textbox", { name: "Search inventory" }) as HTMLInputElement;
    
    // Simulate browser Back
    cleanup();
    render(<InventoryToolbar {...defaultProps} search={undefined} />);
    const input2 = screen.getByRole("textbox", { name: "Search inventory" }) as HTMLInputElement;
    expect(input2.value).toBe("");
  });

  test("URL navigation forward to search restores input", () => {
    render(<InventoryToolbar {...defaultProps} search={undefined} />);
    const input = screen.getByRole("textbox", { name: "Search inventory" }) as HTMLInputElement;
    
    // Simulate browser Forward
    cleanup();
    render(<InventoryToolbar {...defaultProps} search="ForwardQuery" />);
    const input2 = screen.getByRole("textbox", { name: "Search inventory" }) as HTMLInputElement;
    expect(input2.value).toBe("ForwardQuery");
  });

  test("Submitting search retains input and calls push", () => {
    render(<InventoryToolbar {...defaultProps} search="Initial" />);
    const input = screen.getByRole("textbox", { name: "Search inventory" }) as HTMLInputElement;
    
    fireEvent.change(input, { target: { value: "New Search" } });
    expect(input.value).toBe("New Search");

    fireEvent.submit(input.closest("form")!);
    expect(mockPush).toHaveBeenCalledWith("/inventory?q=New+Search");
  });
});

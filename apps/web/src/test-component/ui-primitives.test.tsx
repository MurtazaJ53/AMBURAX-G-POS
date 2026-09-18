import { describe, it, expect, vi } from "vitest";

vi.mock("lucide-react", () => ({
  Mail: () => <svg data-testid="icon-mail" />,
  AlertTriangle: () => <svg data-testid="icon-alert" />
}));

import { render, screen } from "./render";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Table, TableRow, TableCell } from "@/components/ui/table";
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Mail } from "lucide-react";

describe("UI Primitives", () => {
  it("renders Button correctly", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: /click me/i })).toBeTruthy();
  });

  it("renders Badge correctly", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New")).toBeTruthy();
  });

  it("renders Input correctly", () => {
    render(<Input placeholder="Enter email" />);
    expect(screen.getByPlaceholderText("Enter email")).toBeTruthy();
  });

  it("renders Card correctly", () => {
    render(
      <Card>
        <CardTitle>Title</CardTitle>
        <CardContent>Content</CardContent>
      </Card>
    );
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("Content")).toBeTruthy();
  });

  it("renders Skeleton correctly", () => {
    const { container } = render(<Skeleton data-testid="skeleton" className="h-4 w-4" />);
    expect(screen.getByTestId("skeleton")).toBeTruthy();
  });

  it("renders EmptyState correctly", () => {
    render(<EmptyState icon={Mail} title="No Messages" description="Empty inbox" />);
    expect(screen.getByText("No Messages")).toBeTruthy();
    expect(screen.getByText("Empty inbox")).toBeTruthy();
  });

  it("renders ErrorState correctly", () => {
    render(<ErrorState title="Failed to load" />);
    expect(screen.getByText("Failed to load")).toBeTruthy();
  });

  it("renders Table correctly", () => {
    render(
      <Table>
        <tbody>
          <TableRow>
            <TableCell>Cell 1</TableCell>
          </TableRow>
        </tbody>
      </Table>
    );
    expect(screen.getByText("Cell 1")).toBeTruthy();
  });

  it("renders Dialog without crashing", () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent><DialogTitle>Dialog Title</DialogTitle></DialogContent>
      </Dialog>
    );
    expect(screen.getByText("Open")).toBeTruthy();
  });

  it("renders Tabs without crashing", () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList><TabsTrigger value="tab1">Tab 1</TabsTrigger></TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
      </Tabs>
    );
    expect(screen.getByText("Tab 1")).toBeTruthy();
    expect(screen.getByText("Content 1")).toBeTruthy();
  });

  it("renders DropdownMenu without crashing", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByText("Menu")).toBeTruthy();
  });
});






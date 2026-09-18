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
import { LogOut, User, Settings as SettingsIcon } from "lucide-react";

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

  const initials = userName.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md hover:bg-background-hover p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-background-subtle text-xs font-semibold text-secondary border border-border"
        >
          {initials}
        </span>
        <span className="hidden min-w-0 sm:block text-left">
          <span className="block truncate text-sm font-medium text-primary">
            {userName}
          </span>
          <span className="block text-[10px] text-tertiary">{roleLabel}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block text-sm font-medium text-primary">{userName}</span>
          <span className="block text-xs text-tertiary font-normal">{roleLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <User className="mr-2 h-4 w-4" />
          <span>Profile</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <SettingsIcon className="mr-2 h-4 w-4" />
          <span>Account Settings</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} disabled={signingOut} className="text-danger focus:bg-danger-subtle focus:text-danger">
          <LogOut className="mr-2 h-4 w-4" />
          <span>{signingOut ? "Signing out..." : "Sign out"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

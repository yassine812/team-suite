import { Link } from "@tanstack/react-router";

const LINKS = [
  { to: "/mail", label: "Mail" },
  { to: "/calendar", label: "Calendar" },
  { to: "/files", label: "Files" },
  { to: "/meet", label: "Meetings" },
  { to: "/booking", label: "Booking" },
] as const;

/** The app's sections, in the shell's bar. */
export function AppNav() {
  return (
    <nav className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm">
      {LINKS.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
          activeProps={{ className: "bg-muted text-foreground" }}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

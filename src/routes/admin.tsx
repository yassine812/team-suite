import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/client/components/AppShell";
import { PageHeader } from "@/client/components/PageHeader";
import { EmptyState } from "@/client/components/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/client/components/ui/table";
import { formatBytes } from "@/client/lib/format";
import { getTeam } from "@/serverFunctions/admin";

export const Route = createFileRoute("/admin")({
  loader: () => getTeam(),
  component: AdminPage,
});

function AdminPage() {
  const data = Route.useLoaderData();
  return (
    <AppShell>
      <PageHeader title="Team" />
      {!data.allowed ? (
        <div data-testid="admin-only">
          <EmptyState kind="error" title="Only organization admins can see this page" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="text-right">Storage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map((m) => (
              <TableRow key={m.id} data-testid="member-row">
                <TableCell>{m.email}</TableCell>
                <TableCell>{m.address ?? "—"}</TableCell>
                <TableCell className="text-right">
                  {formatBytes(m.used ?? 0)} of {formatBytes(data.quota)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}

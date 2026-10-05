import Link from 'next/link'
import { getAllDevices } from '@/lib/actions/devices'
import { EmptyState } from '@/components/shared/empty-state'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/shared/copy-button'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Smartphone, Wifi, WifiOff } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export const metadata = { title: 'Devices' }

const PLATFORM_ICONS: Record<string, string> = {
  android:        '🤖',
  ios:            '🍎',
  flutter:        '💙',
  'react-native': '⚛️',
}

const PAGE_SIZE = 20

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(parseInt(sp.page || '1', 10) || 1, 1)

  const { devices, error, total, pageSize, totalPages } = await getAllDevices({
    page,
    pageSize: PAGE_SIZE,
  })

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--foreground)]">Devices</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            All registered devices across your projects
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {total} device{total !== 1 ? 's' : ''}
        </Badge>
      </div>

      {error && (
        <p className="rounded-md bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]">
          {error}
        </p>
      )}

      {total === 0 ? (
        <EmptyState
          icon={<Smartphone className="h-6 w-6" />}
          title="No devices registered yet"
          description="Devices appear here when your mobile app calls the registration API."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50">
                  {['Platform', 'Device', 'OS', 'App Version', 'Project', 'Topics', 'Status', 'Last Active'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {devices.map((device) => (
                  <tr key={device.id} className="bg-[var(--card)] hover:bg-[var(--muted)]/20 transition-colors">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-[var(--foreground)]">
                        <span>{PLATFORM_ICONS[device.platform] ?? '📱'}</span>
                        <span className="capitalize">{device.platform}</span>
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-[var(--foreground)]">
                          {device.deviceModel ?? '—'}
                        </p>
                        {device.externalUserId && (
                          <div className="mt-0.5 flex items-center gap-0.5">
                            <p
                              className="max-w-[180px] truncate font-mono text-xs text-[var(--muted-foreground)]"
                              title={device.externalUserId}
                            >
                              {device.externalUserId}
                            </p>
                            <CopyButton
                              value={device.externalUserId}
                              label="Copy"
                              className="h-6 px-1.5"
                            />
                          </div>
                        )}
                        <p className="font-mono text-xs text-[var(--muted-foreground)]">
                          {device.deviceId.slice(0, 16)}…
                        </p>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-[var(--muted-foreground)]">
                      {device.deviceOs ?? '—'}
                    </td>

                    <td className="px-4 py-3 text-[var(--muted-foreground)]">
                      {device.appVersion ?? '—'}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge
                        variant="outline"
                        title={device.projectName}
                        className="whitespace-nowrap px-2.5 py-1 text-xs font-medium"
                      >
                        {device.projectName}
                      </Badge>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {device.topicNames.length > 0
                          ? device.topicNames.map((t) => (
                              <Badge key={t} variant="secondary" className="px-1.5 py-0 text-xs">
                                {t}
                              </Badge>
                            ))
                          : <span className="text-xs text-[var(--muted-foreground)]">—</span>}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {device.subscriptionStatus === 'subscribed' ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <Wifi className="h-3 w-3" /> Subscribed
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                          <WifiOff className="h-3 w-3" /> Unsubscribed
                        </span>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--muted-foreground)]">
                      {device.lastActive ? formatDate(device.lastActive) : formatDate(device.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--muted-foreground)]">
              Showing {from}–{to} of {total}
            </p>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/dashboard/devices?page=${page - 1}`}>
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
              )}
              <span className="min-w-[5rem] text-center text-sm text-[var(--muted-foreground)]">
                Page {page} / {totalPages || 1}
              </span>
              {page < totalPages ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/dashboard/devices?page=${page + 1}`}>
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

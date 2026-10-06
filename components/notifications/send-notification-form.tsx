'use client'

import { useActionState, useEffect, useState } from 'react'
import { ImageIcon, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { sendNotification } from '@/lib/actions/notifications'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import type { Project, Topic } from '@/types'

interface SegmentOption {
  id: string
  name: string
}

interface SendNotificationFormProps {
  projects: Project[]
  topics?:  Topic[]
  segments?: SegmentOption[]
}

const PLATFORM_TARGETS = [
  { value: 'all',     label: 'All users' },
  { value: 'android', label: 'Android' },
  { value: 'ios',     label: 'iOS' },
  { value: 'user',    label: 'Specific user (External ID)' },
]

export function SendNotificationForm({ projects, topics = [], segments = [] }: SendNotificationFormProps) {
  const router = useRouter()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [target, setTarget] = useState('all')
  const [formNonce, setFormNonce] = useState(0)
  const [titlePreview, setTitlePreview] = useState('')
  const [bodyPreview, setBodyPreview] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [iconUrl, setIconUrl] = useState('')
  const [imageBroken, setImageBroken] = useState(false)

  const [state, action, isPending] = useActionState(
    async (prev: unknown, formData: FormData) => {
      const result = await sendNotification(prev, formData)
      return result
    },
    null
  )

  useEffect(() => {
    if (state?.success) {
      const count = state.recipientCount ?? 0
      toast.success(
        count > 0
          ? `Notification sent to ${count} device${count === 1 ? '' : 's'}`
          : 'Notification sent'
      )
      setTarget('all')
      setTitlePreview('')
      setBodyPreview('')
      setImageUrl('')
      setIconUrl('')
      setImageBroken(false)
      setFormNonce((n) => n + 1)
      router.refresh()
    }
  }, [state, router])

  if (projects.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">
            Create a project first before sending notifications.
          </p>
        </CardContent>
      </Card>
    )
  }

  const segmentTargets = segments.map((s) => ({
    value: `segment:${s.id}`,
    label: `🎯 Segment: ${s.name}`,
  }))

  // Topics are tenant/project scoped. Never offer a topic that belongs to a
  // different selected project in the notification composer.
  const topicTargets = topics
    .filter((t) => t.projectId === projectId)
    .map((t) => ({
      value: `topic:${t.name}`,
      label: t.description ? t.description : `Topic: ${t.name}`,
    }))

  const allTargets = [...PLATFORM_TARGETS, ...segmentTargets, ...topicTargets]
  const isRich = Boolean(imageUrl.trim())

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-4 w-4 text-[var(--primary)]" />
          Send Notification
        </CardTitle>
        <CardDescription>
          Broadcasts go through FCM topics (all users, OS, country, app version) — not a database token scan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form key={formNonce} action={action} className="space-y-4">
          {/* Project */}
          <div className="space-y-1.5">
            <Label htmlFor="projectId">Project</Label>
            <Select
              id="projectId"
              name="projectId"
              required
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value)
                setTarget('all')
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>

          {/* Target — controlled so it never desyncs from the ID field */}
          <div className="space-y-1.5">
            <Label htmlFor="target">Send to</Label>
            <Select
              id="target"
              name="target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              {allTargets.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </div>

          {target === 'user' && (
            <div className="space-y-1.5">
              <Label htmlFor="externalUserId">External User ID</Label>
              <Input
                id="externalUserId"
                name="externalUserId"
                placeholder="Paste the ID copied from Devices"
                required
              />
              <p className="text-xs text-[var(--muted-foreground)]">
                Paste the ID from the Devices page Copy button. Sends to every device registered with this user.
              </p>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              placeholder="Notification title"
              required
              maxLength={100}
              value={titlePreview}
              onChange={(e) => setTitlePreview(e.target.value)}
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <Label htmlFor="body">Message</Label>
            <Textarea
              id="body"
              name="body"
              placeholder="Notification message body"
              required
              maxLength={500}
              rows={3}
              value={bodyPreview}
              onChange={(e) => setBodyPreview(e.target.value)}
            />
          </div>

          {/* Launch URL / Action Link */}
          <div className="space-y-1.5">
            <Label htmlFor="url">Action Link / Launch URL (Optional)</Label>
            <Input
              id="url"
              name="url"
              type="url"
              placeholder="e.g. https://earnslash.com/stories/123"
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              When users click the notification, their browser or app will open this URL.
            </p>
          </div>

          {/* Rich Push */}
          <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-[var(--primary)]" />
                <Label className="text-sm font-medium">Rich Push</Label>
              </div>
              {isRich && (
                <span className="rounded-full bg-[var(--primary)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--primary)]">
                  Big Picture
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              Public HTTPS image URL. Works with <strong>all</strong>, <strong>OS</strong>, <strong>topic</strong>, and <strong>user</strong> targets — Big Picture on Android, rich media on iOS / web.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="imageUrl">Image URL</Label>
              <Input
                id="imageUrl"
                name="imageUrl"
                type="url"
                placeholder="https://cdn.example.com/banner.jpg"
                value={imageUrl}
                onChange={(e) => {
                  setImageUrl(e.target.value)
                  setImageBroken(false)
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="iconUrl">Large Icon URL (Optional)</Label>
              <Input
                id="iconUrl"
                name="iconUrl"
                type="url"
                placeholder="https://cdn.example.com/icon.png"
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
              />
              <p className="text-xs text-[var(--muted-foreground)]">
                Circular large icon next to the title (Android / web). Prefer a square PNG.
              </p>
            </div>

            {/* Live preview */}
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-sm">
              <div className="border-b border-[var(--border)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Preview
              </div>
              <div className="flex gap-3 p-3">
                {iconUrl.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={iconUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-full object-cover bg-[var(--muted)]"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-xs font-bold text-[var(--primary)]">
                    N
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-tight">
                    {titlePreview.trim() || 'Notification title'}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-[var(--muted-foreground)]">
                    {bodyPreview.trim() || 'Your message will appear here'}
                  </p>
                </div>
              </div>
              {imageUrl.trim() && !imageBroken && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt="Rich push preview"
                  className="max-h-48 w-full object-cover"
                  onError={() => setImageBroken(true)}
                />
              )}
              {imageUrl.trim() && imageBroken && (
                <div className="flex h-24 items-center justify-center bg-[var(--muted)] text-xs text-[var(--muted-foreground)]">
                  Image could not be loaded — check the URL is public HTTPS
                </div>
              )}
            </div>
          </div>

          {state?.error && (
            <p className="rounded-md bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
              {state.error}
            </p>
          )}

          <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
            {isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Sending…</>
            ) : (
              <><Send className="h-4 w-4" />Send notification</>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

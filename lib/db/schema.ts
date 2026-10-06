/**
 * Drizzle ORM schema for Cloudflare D1 (SQLite).
 * OneSignal-grade Push Notification Architecture.
 */

import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ── Users ─────────────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id:           text('id').primaryKey(),
  email:        text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt:    text('created_at').notNull().default(sql`(datetime('now'))`),
})

// ── Better Auth Tables ────────────────────────────────────────────────────────
export const baUser = sqliteTable('ba_user', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  email:         text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image:         text('image'),
  role:          text('role').notNull().default('user'),
  status:        text('status').notNull().default('active'),
  createdAt:     integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:     integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
})

export const baSession = sqliteTable('ba_session', {
  id:         text('id').primaryKey(),
  expiresAt:  integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  token:      text('token').notNull().unique(),
  createdAt:  integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:  integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  ipAddress:  text('ipAddress'),
  userAgent:  text('userAgent'),
  userId:     text('userId').notNull(),
})

export const baAccount = sqliteTable('ba_account', {
  id:                    text('id').primaryKey(),
  accountId:             text('accountId').notNull(),
  providerId:            text('providerId').notNull(),
  userId:                text('userId').notNull(),
  accessToken:           text('accessToken'),
  refreshToken:          text('refreshToken'),
  idToken:               text('idToken'),
  accessTokenExpiresAt:  integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
  scope:                 text('scope'),
  password:              text('password'),
  createdAt:             integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt:             integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
})

export const baVerification = sqliteTable('ba_verification', {
  id:         text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value:      text('value').notNull(),
  expiresAt:  integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  createdAt:  integer('createdAt', { mode: 'timestamp_ms' }),
  updatedAt:  integer('updatedAt', { mode: 'timestamp_ms' }),
})

// ── Projects ──────────────────────────────────────────────────────────────────
export const projects = sqliteTable('projects', {
  id:               text('id').primaryKey(),
  userId:           text('user_id').notNull(),
  name:             text('name').notNull(),
  appId:            text('app_id').notNull().unique(),
  apiKey:           text('api_key').notNull(),
  firebaseJsonPath: text('firebase_json_path'),
  firebaseCredentials: text('firebase_credentials'),
  createdAt:        text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  userIdIdx: index('projects_user_id_idx').on(t.userId),
  appIdIdx:  index('projects_app_id_idx').on(t.appId),
}))

// ── Device Subscriptions (OneSignal Parity) ──────────────────────────────────
export const devices = sqliteTable('devices', {
  id:                     text('id').primaryKey(),
  projectId:              text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId:                 text('user_id'),             // Developer's external userId
  externalUserId:         text('external_user_id'),    // Alias for userId
  deviceId:               text('device_id').notNull(),
  fcmToken:               text('fcm_token').notNull(),
  platform:               text('platform', { enum: ['android', 'ios', 'flutter', 'react-native'] }).notNull(),
  country:                text('country'),             // e.g. "IN", "US"
  language:               text('language'),            // e.g. "en", "gu"
  timezone:               text('timezone'),            // e.g. "Asia/Karachi"
  appVersion:             text('app_version'),         // e.g. "2.1.0"
  osVersion:              text('os_version'),          // e.g. "Android 14", "iOS 17.2"
  deviceOs:               text('device_os'),           // Alias for osVersion
  deviceModel:            text('device_model'),        // e.g. "Samsung S24"
  sdkVersion:             text('sdk_version'),         // e.g. "1.0.0"
  notificationPermission: text('notification_permission', {
                            enum: ['granted', 'denied', 'default'],
                          }).notNull().default('granted'),
  status:                 text('status', {
                            enum: ['active', 'inactive'],
                          }).notNull().default('active'),
  subscriptionStatus:     text('subscription_status').notNull().default('subscribed'), // Compatibility column
  lastOpen:               text('last_open').notNull().default(sql`(datetime('now'))`),
  lastActive:             text('last_active').notNull().default(sql`(datetime('now'))`), // Compatibility column
  lastTokenUpdate:        text('last_token_update').notNull().default(sql`(datetime('now'))`),
  inactiveAt:             text('inactive_at'),
  createdAt:              text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt:              text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  projectIdIdx:        index('devices_project_id_idx').on(t.projectId),
  projectDeviceUnique: uniqueIndex('devices_project_device_unique').on(t.projectId, t.deviceId),
  fcmTokenIdx:         index('devices_fcm_token_idx').on(t.fcmToken),
  userIdIdx:           index('devices_user_id_idx').on(t.projectId, t.userId),
  statusIdx:           index('devices_status_idx').on(t.projectId, t.status),
  segmentFilterIdx:    index('devices_segment_filter_idx').on(t.projectId, t.status, t.country, t.language, t.platform),
}))

export const deviceSubscriptions = devices

// ── Topics ────────────────────────────────────────────────────────────────────
export const topics = sqliteTable('topics', {
  id:          text('id').primaryKey(),
  projectId:   text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),                 // e.g. "all_app_…", "country_in_…"
  // Production D1 stores this as `kind`; expose the real column name so
  // topic creation and system-topic sync do not silently fail on insert.
  kind:        text('kind', { enum: ['system', 'custom'] }).notNull().default('custom'),
  description: text('description'),
  isActive:    integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt:   text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  projectTopicUnique: uniqueIndex('topics_project_name_unique').on(t.projectId, t.name),
  projectIdIdx:       index('topics_project_id_idx').on(t.projectId),
}))

// ── Device Topics ─────────────────────────────────────────────────────────────
export const deviceTopics = sqliteTable('device_topics', {
  id:         text('id').primaryKey(),
  deviceId:   text('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  topicId:    text('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
  assignedAt: text('assigned_at').notNull().default(sql`(datetime('now'))`),
  assignedBy: text('assigned_by').notNull().default('system'),
}, (t) => ({
  deviceTopicUnique: uniqueIndex('device_topics_unique').on(t.deviceId, t.topicId),
  deviceIdx:         index('device_topics_device_idx').on(t.deviceId),
  topicIdx:          index('device_topics_topic_idx').on(t.topicId),
}))

// ── Dynamic User Segments ──────────────────────────────────────────────────────
export const segments = sqliteTable('segments', {
  id:          text('id').primaryKey(),
  projectId:   text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  description: text('description'),
  createdAt:   text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt:   text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  projectIdIdx: index('segments_project_id_idx').on(t.projectId),
}))

export const segmentRules = sqliteTable('segment_rules', {
  id:        text('id').primaryKey(),
  segmentId: text('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  field:     text('field').notNull(),
  operator:  text('operator', {
               enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'],
             }).notNull(),
  value:     text('value').notNull(),
}, (t) => ({
  segmentIdx: index('segment_rules_segment_idx').on(t.segmentId),
}))

// ── Notification Campaigns ────────────────────────────────────────────────────
export const notificationCampaigns = sqliteTable('notification_campaigns', {
  id:           text('id').primaryKey(),
  projectId:    text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name:         text('name').notNull(),
  title:        text('title').notNull(),
  body:         text('body').notNull(),
  image:        text('image'),
  imageUrl:     text('image_url'),
  url:          text('url'),
  icon:         text('icon'),
  badge:        integer('badge'),
  sound:        text('sound'),
  deepLink:     text('deep_link'),
  clickAction:  text('click_action'),
  target:       text('target').notNull().default('all'),
  priority:     text('priority', { enum: ['high', 'normal'] }).notNull().default('high'),
  ttl:          integer('ttl').notNull().default(86400),
  channelId:    text('channel_id'),
  data:         text('data'),
  targetType:   text('target_type', { enum: ['topic', 'device', 'segment'] }).notNull().default('topic'),
  targetValue:  text('target_value').notNull().default('all_users'),
  status:       text('status', {
                  enum: ['pending', 'draft', 'queued', 'processing', 'completed', 'sent', 'failed', 'paused', 'cancelled'],
                }).notNull().default('completed'),
  recipientCount: integer('recipient_count').notNull().default(0),
  sentCount:    integer('sent_count').notNull().default(0),
  failureCount: integer('failure_count').notNull().default(0),
  openCount:    integer('open_count').notNull().default(0),
  clickCount:   integer('click_count').notNull().default(0),
  sentAt:       text('sent_at'),
  createdAt:    text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt:    text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  projectIdIdx: index('campaigns_project_id_idx').on(t.projectId),
  statusIdx:    index('campaigns_status_idx').on(t.status),
}))

// Backward compatibility alias
export const notifications = notificationCampaigns

// ── Notification Logs ─────────────────────────────────────────────────────────
export const notificationLogs = sqliteTable('notification_logs', {
  id:           text('id').primaryKey(),
  campaignId:   text('campaign_id').notNull().references(() => notificationCampaigns.id, { onDelete: 'cascade' }),
  deviceId:     text('device_id').references(() => devices.id, { onDelete: 'set null' }),
  fcmToken:     text('fcm_token').notNull(),
  status:       text('status', { enum: ['queued', 'sent', 'failed', 'delivered'] }).notNull().default('queued'),
  errorCode:    text('error_code'),
  retryCount:   integer('retry_count').notNull().default(0),
  lastRetryAt:  text('last_retry_at'),
  nextRetryAt:  text('next_retry_at'),
  sentAt:       text('sent_at'),
  deliveredAt:  text('delivered_at'),
  createdAt:    text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  campaignIdx:  index('logs_campaign_idx').on(t.campaignId),
  deviceIdx:    index('logs_device_idx').on(t.deviceId),
  fcmTokenIdx:  index('logs_fcm_token_idx').on(t.fcmToken),
  statusIdx:    index('logs_status_idx').on(t.status),
}))

// ── Notification Events (Telemetry: Open / Click) ─────────────────────────────
export const notificationEvents = sqliteTable('notification_events', {
  id:             text('id').primaryKey(),
  notificationId: text('notification_id'),
  campaignId:     text('campaign_id').notNull().references(() => notificationCampaigns.id, { onDelete: 'cascade' }),
  deviceId:       text('device_id'),
  userId:         text('user_id'),
  eventType:      text('event_type', { enum: ['open', 'click'] }).notNull(),
  timestamp:      text('timestamp').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  campaignIdx:  index('events_campaign_idx').on(t.campaignId),
  eventIdx:     index('events_type_idx').on(t.eventType),
}))

// ── Types ─────────────────────────────────────────────────────────────────────
export type User                 = typeof users.$inferSelect
export type NewUser              = typeof users.$inferInsert
export type BaUser               = typeof baUser.$inferSelect
export type NewBaUser            = typeof baUser.$inferInsert
export type Project              = typeof projects.$inferSelect
export type NewProject           = typeof projects.$inferInsert
export type DeviceSubscription   = typeof devices.$inferSelect
export type NewDeviceSubscription= typeof devices.$inferInsert
export type Device               = DeviceSubscription
export type NewDevice            = NewDeviceSubscription
export type Topic                = typeof topics.$inferSelect
export type NewTopic             = typeof topics.$inferInsert
export type DeviceTopic          = typeof deviceTopics.$inferSelect
export type Segment              = typeof segments.$inferSelect
export type SegmentRule          = typeof segmentRules.$inferSelect
export type NotificationCampaign = typeof notificationCampaigns.$inferSelect
export type NewNotificationCampaign = typeof notificationCampaigns.$inferInsert
export type Notification         = NotificationCampaign
export type NewNotification      = NewNotificationCampaign
export type NotificationLog      = typeof notificationLogs.$inferSelect
export type NotificationEvent    = typeof notificationEvents.$inferSelect

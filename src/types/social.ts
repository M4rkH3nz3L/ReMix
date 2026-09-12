/**
 * Social réteg adatmodellje (SOCIAL-TODO.md M0/M2/M4/M5).
 *
 * Elv: a poszt NEM önálló videórekord, hanem a Project Model egy NÉZETE — a
 * `projectId` (+ opcionálisan a hordozott `projectSnapshot`) teszi a feed
 * bármelyik videóját megnyithatóvá/remixelhetővé a Studióban. Minden mező úgy
 * van elnevezve, hogy a jövőbeli backend (Postgres/S3) sémájára egy-az-egyben
 * ráképződjön — a jelenlegi tár AsyncStorage-alapú, de az API-alak azonos.
 */

import type { AspectRatio, Project } from '@/types/project';

/** Feed-módok (M3). A ranker az M11-ben jön — most heurisztikus. */
export type FeedMode = 'foryou' | 'following' | 'latest';

/** Poszt-láthatóság (SOCIAL §13). */
export type PostVisibility = 'public' | 'unlisted' | 'private';

/** Moderációs állapot — már az első sémában (M9 anti-cél: ne utólag). */
export type ModerationStatus = 'ok' | 'pending' | 'removed';

/** Egy alkotó (a saját „én" is ilyen — lásd feedRepo.getCurrentUser). */
export interface Creator {
  id: string;
  username: string;
  displayName: string;
  /** avatar-URI (hiányában kezdőbetűs badge) */
  avatarUri?: string;
  verified?: boolean;
}

/** Egységes engagement-számlálók (SOCIAL §8). */
export interface EngagementCounts {
  likes: number;
  comments: number;
  saves: number;
  views: number;
  /** hányan remixelték (M4 remix-lánc) */
  remixes: number;
}

/** A bejelentkezett user viszonya EGY poszthoz (lokálisan tárolva). */
export interface PostEngagement {
  liked: boolean;
  saved: boolean;
  viewed: boolean;
}

/**
 * Feed-poszt. A `videoUri` a lejátszható forrás (renderelt MP4, vagy render
 * hiányában a nyers első videóklip előnézete — lásd `rendered`). A remixhez a
 * `projectId`-t a Studio lokális tárában keressük; ha nincs meg (pl. másik
 * eszközről érkezett poszt), a `projectSnapshot` a tartalék.
 */
export interface FeedPost {
  id: string;
  creator: Creator;
  title: string;
  description: string;
  hashtags: string[];
  /** lejátszható videó (renderelt MP4 vagy nyers előnézet); null = nincs média */
  videoUri: string | null;
  /** borítókép (első kocka) — lejátszás előtt/alatt */
  posterUri: string | null;
  aspectRatio: AspectRatio;
  durationSec: number;
  /** a szerkeszthető projekt azonosítója (a Studio lokális tárában) */
  projectId?: string;
  /** hordozható projekt-pillanatkép a remixhez (M2 `.vided` analógja) */
  projectSnapshot?: Project;
  /** true, ha a `videoUri` a teljes idővonal renderje (nem csak az első klip) */
  rendered: boolean;
  /** remixelhető-e (M4): ha false, csak megtekintés */
  remixable: boolean;
  /** ha ez egy remix, a forrás-poszt azonosítója (M4 attribúció) */
  remixOfPostId?: string;
  /** a forrás-alkotó neve a „Remix ebből: @X" címkéhez */
  remixOfCreator?: string;
  visibility: PostVisibility;
  moderationStatus: ModerationStatus;
  /** kiemelt (megfizetett promóció) — a feed előre sorolja + jelvényt mutat */
  promoted?: boolean;
  /** zene-attribúció (SOCIAL §5) — hiányában a cím megy „eredeti hang"-ként */
  music?: string;
  createdAt: string;
  counts: EngagementCounts;
  /** a néző viszonya a poszthoz (a feed-RPC egy körben adja) */
  viewerLiked?: boolean;
  viewerSaved?: boolean;
}

/** Komment (SOCIAL §9) — nested reply, mention, pin. */
export interface Comment {
  id: string;
  postId: string;
  author: Creator;
  body: string;
  /** válasz esetén a szülő-komment id-ja */
  parentId?: string;
  createdAt: string;
  likes: number;
  /** kedveltem-e ezt a kommentet */
  viewerLiked?: boolean;
  /** alkotó által kiemelt komment */
  pinned?: boolean;
}

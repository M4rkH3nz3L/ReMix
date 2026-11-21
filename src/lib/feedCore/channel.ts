import type { Creator, FeedPost } from '@/types/social';

/** Egy csatorna: az alkotó posztjai + statisztika + követem-e. */
export interface ChannelData {
  userId: string;
  creator: Creator | null;
  /** 🖼️ borítókép (banner) URL — a csatorna-fejlécben; hiányában gradient-placeholder */
  coverUri?: string;
  // 🎨 Creator réteg (publikus mezők a public_profile-ból)
  bio?: string;
  aboutMe?: string;
  whatIMake?: string;
  workingOn?: string;
  creatorTypes?: string[];
  skills?: string[];
  interests?: string[];
  languages?: string[];
  posts: FeedPost[];
  followers: number;
  following: number;
  postCount: number;
  isFollowing: boolean;
  isMe: boolean;
}

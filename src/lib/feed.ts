/**
 * 📱 Feed / csatorna kliens-réteg. A poszt a Project egy NÉZETE — a
 * `projectSnapshot` teszi a feed bármely videóját REMIXELHETŐVÉ a Studióban (ez
 * a „studio az alap" kapcsolat). Szerver-backend (Supabase), így a userek látják
 * egymás tartalmát. Az engagement szerver-hiteles (számlálók triggerrel).
 */

// Barrel — expo-mentes mag: feedCore/ (sor-leképezés, rangsor, keresés-szűrő);
// hálózat: feedClient/ (Supabase-lekérdezések, posztolás, engagement, kommentek, remix)
export { rankForYou, rankTrendingFeed } from '@/lib/feedCore/ranking';
export { orFilterValue, type SearchResults } from '@/lib/feedCore/search';
export type { ChannelData } from '@/lib/feedCore/channel';
export type { PostComment } from '@/lib/feedCore/comments';
export { currentUserId } from '@/lib/feedClient/session';
export { listFeed, listPostsByHashtag, listPostsByIds, searchFeed } from '@/lib/feedClient/queries';
export { getChannel } from '@/lib/feedClient/channel';
export { publishLiveVod, publishPost } from '@/lib/feedClient/publish';
export { publishImageProject, publishRenderedProject } from '@/lib/feedClient/publishProject';
export {
  deletePost,
  deletePostsForProject,
  fetchViewEvents,
  recordView,
  recordViewEvent,
  toggleFollow,
  toggleLike,
  toggleSave,
} from '@/lib/feedClient/engagement';
export { remixFromPost } from '@/lib/feedClient/remix';
export { addComment, deleteComment, listComments, subscribeComments } from '@/lib/feedClient/comments';
export { listRemixesOf, moderateRemix } from '@/lib/feedClient/moderation';

import { Clock, Files, Star, Trash2, type LucideIcon } from 'lucide-react';
import { CATEGORIES } from './categories';
import type { Category, FileScope } from '@/types';

export interface LibraryView {
  key: string;
  path: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  scope: FileScope;
  category?: Category;
  /** Where the Upload button on this page files new uploads. */
  uploadCategory: Category | 'auto';
  showTypeFilter: boolean;
  squareSkeleton: boolean;
  empty: { title: string; description: string };
}

const cat = (id: Category, subtitle: string, empty: LibraryView['empty']): LibraryView => ({
  key: id,
  path: CATEGORIES[id].route,
  title: CATEGORIES[id].plural,
  subtitle,
  icon: CATEGORIES[id].icon,
  scope: 'category',
  category: id,
  uploadCategory: id === 'screenshot' ? 'screenshot' : 'auto',
  showTypeFilter: false,
  squareSkeleton: id === 'image' || id === 'screenshot',
  empty,
});

export const LIBRARY_VIEWS: LibraryView[] = [
  {
    key: 'all',
    path: '/files',
    title: 'All Files',
    subtitle: 'Everything stored in your vault.',
    icon: Files,
    scope: 'all',
    uploadCategory: 'auto',
    showTypeFilter: true,
    squareSkeleton: false,
    empty: { title: 'Your vault is empty', description: 'Upload photos, PDFs, documents and videos to start building your private library.' },
  },
  cat('image', 'Photos and pictures in your library.', {
    title: 'No images yet',
    description: 'Upload JPG, PNG, WebP, GIF, SVG or HEIC files.',
  }),
  cat('screenshot', 'Screenshots, kept separate from your photos.', {
    title: 'No screenshots yet',
    description: 'Files uploaded from this page are stored as screenshots.',
  }),
  cat('pdf', 'Your PDF library, viewable right in the browser.', {
    title: 'No PDFs yet',
    description: 'Upload PDF files to read them here without downloading.',
  }),
  cat('document', 'Word, text, spreadsheet and other documents.', {
    title: 'No documents yet',
    description: 'Upload DOC, DOCX, TXT, RTF, ODT and more.',
  }),
  cat('video', 'Videos from your phone, camera or computer.', {
    title: 'No videos yet',
    description: 'Upload MP4, MOV, M4V, WebM and other video files.',
  }),
  cat('other', 'Files that don’t fit another category.', {
    title: 'No other files',
    description: 'Archives, audio and other formats appear here.',
  }),
  {
    key: 'favorites',
    path: '/favorites',
    title: 'Favorites',
    subtitle: 'Files you’ve starred for quick access.',
    icon: Star,
    scope: 'favorites',
    uploadCategory: 'auto',
    showTypeFilter: true,
    squareSkeleton: false,
    empty: { title: 'No favorites yet', description: 'Tap the star on any file to add it here.' },
  },
  {
    key: 'recent',
    path: '/recent',
    title: 'Recent',
    subtitle: 'Recently uploaded and recently opened files.',
    icon: Clock,
    scope: 'recent_uploaded',
    uploadCategory: 'auto',
    showTypeFilter: true,
    squareSkeleton: false,
    empty: { title: 'Nothing recent', description: 'Files you upload or open will show up here.' },
  },
  {
    key: 'trash',
    path: '/trash',
    title: 'Trash',
    subtitle: 'Deleted files stay here until you remove them permanently.',
    icon: Trash2,
    scope: 'trash',
    uploadCategory: 'auto',
    showTypeFilter: true,
    squareSkeleton: false,
    empty: { title: 'Trash is empty', description: 'Files you move to trash can be restored from here.' },
  },
];

export function findView(pathname: string): LibraryView | undefined {
  return LIBRARY_VIEWS.find((v) => v.path === pathname);
}

export const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/storage': 'Storage',
  '/settings': 'Settings',
  ...Object.fromEntries(LIBRARY_VIEWS.map((v) => [v.path, v.title])),
};

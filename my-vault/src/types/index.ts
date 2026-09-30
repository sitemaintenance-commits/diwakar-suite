export type Category = 'image' | 'screenshot' | 'pdf' | 'document' | 'other';

/** Row of public.files */
export interface VaultFileRow {
  id: string;
  user_id: string;
  original_name: string;
  display_name: string;
  storage_path: string;
  thumbnail_path: string | null;
  mime_type: string;
  extension: string;
  category: Category;
  size_bytes: number;
  width: number | null;
  height: number | null;
  page_count: number | null;
  is_favorite: boolean;
  tags: string[];
  description: string;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  deleted_at: string | null;
}

/** A file row enriched with a short-lived signed thumbnail URL. */
export interface VaultFile extends VaultFileRow {
  thumbUrl: string | null;
}

export type FileScope =
  | 'all'
  | 'category'
  | 'favorites'
  | 'recent_uploaded'
  | 'recent_accessed'
  | 'trash';

export type SortKey = 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'largest' | 'smallest';
export type DateFilter = 'any' | 'today' | '7d' | '30d' | '365d';
export type SizeFilter = 'any' | 'small' | 'medium' | 'large' | 'huge';

export interface FileFilters {
  search: string;
  sort: SortKey;
  date: DateFilter;
  size: SizeFilter;
  favoritesOnly: boolean;
  /** File-type filter (only offered on mixed-type views). */
  type: Category | 'any';
}

export interface FileQuery extends FileFilters {
  scope: FileScope;
  category?: Category;
  pageSize: number;
}

export interface FilePage {
  items: VaultFile[];
  nextOffset: number | null;
  total: number | null;
}

export interface VaultStats {
  total_files: number;
  images: number;
  screenshots: number;
  pdfs: number;
  documents: number;
  other: number;
  favorites: number;
  trash: number;
  recent_7d: number;
  total_bytes: number;
  trash_bytes: number;
  bytes_by_category: Partial<Record<Category, number>>;
  quota_bytes: number | null;
}

export type ViewMode = 'grid' | 'list';
export type ThemePref = 'light' | 'dark' | 'system';

export interface Preferences {
  view: ViewMode;
  pageSize: number;
  theme: ThemePref;
}

export interface Profile {
  id: string;
  full_name: string;
  avatar_path: string | null;
  preferences: Partial<Preferences>;
  storage_quota_bytes: number;
  created_at: string;
  updated_at: string;
}

export type UploadStatus = 'queued' | 'uploading' | 'processing' | 'done' | 'error' | 'canceled';

export interface UploadItem {
  id: string;
  file: File;
  category: Category;
  status: UploadStatus;
  progress: number;
  error?: string;
}

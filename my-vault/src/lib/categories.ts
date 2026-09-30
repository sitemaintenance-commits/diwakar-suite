import { FileImage, FileText, FileType2, Folder, MonitorSmartphone, type LucideIcon } from 'lucide-react';
import type { Category } from '@/types';

export interface CategoryDef {
  id: Category;
  label: string;
  plural: string;
  /** Storage folder under <user-id>/ */
  folder: string;
  route: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon chip */
  tone: string;
  extensions: string[];
  mimePrefixes: string[];
}

/**
 * Single source of truth for file categorisation. To add a category:
 * 1. add it here, 2. extend the `category` check + folder regex in schema.sql,
 * 3. add a route in src/lib/views.ts.
 */
export const CATEGORIES: Record<Category, CategoryDef> = {
  image: {
    id: 'image',
    label: 'Image',
    plural: 'Images',
    folder: 'images',
    route: '/images',
    icon: FileImage,
    tone: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400',
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff', 'ico'],
    mimePrefixes: ['image/'],
  },
  screenshot: {
    id: 'screenshot',
    label: 'Screenshot',
    plural: 'Screenshots',
    folder: 'screenshots',
    route: '/screenshots',
    icon: MonitorSmartphone,
    tone: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
    // Screenshots are images the user explicitly files as screenshots.
    extensions: [],
    mimePrefixes: [],
  },
  pdf: {
    id: 'pdf',
    label: 'PDF',
    plural: 'PDFs',
    folder: 'pdfs',
    route: '/pdfs',
    icon: FileType2,
    tone: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
    extensions: ['pdf'],
    mimePrefixes: ['application/pdf'],
  },
  document: {
    id: 'document',
    label: 'Document',
    plural: 'Documents',
    folder: 'documents',
    route: '/documents',
    icon: FileText,
    tone: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
    extensions: [
      'doc', 'docx', 'txt', 'rtf', 'odt', 'md', 'markdown', 'csv', 'tsv',
      'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'pages', 'numbers', 'key', 'epub', 'json', 'xml', 'log',
    ],
    mimePrefixes: [
      'text/',
      'application/msword',
      'application/vnd.openxmlformats-officedocument',
      'application/vnd.oasis.opendocument',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/rtf',
    ],
  },
  other: {
    id: 'other',
    label: 'Other',
    plural: 'Other Files',
    folder: 'other',
    route: '/other',
    icon: Folder,
    tone: 'bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300',
    extensions: [],
    mimePrefixes: [],
  },
};

export const CATEGORY_ORDER: Category[] = ['image', 'screenshot', 'pdf', 'document', 'other'];

/** Mirrors files_extension_not_blocked in schema.sql. */
export const BLOCKED_EXTENSIONS = ['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'jar', 'app', 'dll', 'sh'];

export function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
}

export function isImageFile(file: { name: string; type: string }): boolean {
  const ext = getExtension(file.name);
  return CATEGORIES.image.extensions.includes(ext) || file.type.startsWith('image/');
}

/** Automatic category detection. Extension wins; MIME type is the fallback. */
export function detectCategory(file: { name: string; type: string }, requested?: Category | 'auto'): Category {
  if (requested === 'screenshot' && isImageFile(file)) return 'screenshot';
  const ext = getExtension(file.name);
  for (const id of ['pdf', 'image', 'document'] as const) {
    if (CATEGORIES[id].extensions.includes(ext)) return id;
  }
  const mime = file.type.toLowerCase();
  for (const id of ['pdf', 'image', 'document'] as const) {
    if (mime && CATEGORIES[id].mimePrefixes.some((p) => mime.startsWith(p))) return id;
  }
  return 'other';
}

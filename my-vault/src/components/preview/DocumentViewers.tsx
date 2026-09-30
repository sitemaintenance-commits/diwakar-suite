import { useEffect, useState } from 'react';
import { AlertTriangle, Download, RotateCw } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/misc';
import { PreviewError } from './PreviewFallback';

function useRemote<T>(url: string, load: (res: Response) => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ loading: true });
    fetch(url, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
        return load(res);
      })
      .then((data) => setState({ data, loading: false }))
      .catch((e) => {
        if (e?.name !== 'AbortError') setState({ error: getErrorMessage(e, 'Could not load file.'), loading: false });
      });
    return () => ctrl.abort();
  }, [url]);
  return state;
}

const Loading = () => (
  <div className="flex h-full items-center justify-center">
    <Spinner className="size-7 text-white" />
  </div>
);

export function TextViewer({ url, onDownload }: { url: string; onDownload: () => void }) {
  const { data, error, loading } = useRemote(url, (r) => r.text());
  if (loading) return <Loading />;
  if (error) return <PreviewError message={error} onDownload={onDownload} />;
  return (
    <div className="scrollbar-thin h-full overflow-auto p-3 sm:p-6">
      <pre className="mx-auto max-w-4xl rounded-xl bg-surface p-5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink shadow-2xl">
        {data || '(empty file)'}
      </pre>
    </div>
  );
}

/** DOCX → sanitized HTML (mammoth + DOMPurify), loaded on demand. */
export function DocxViewer({ url, onDownload }: { url: string; onDownload: () => void }) {
  const { data, error, loading } = useRemote(url, async (r) => {
    const [buf, mammoth, purify] = await Promise.all([r.arrayBuffer(), import('mammoth'), import('dompurify')]);
    let result: { value: string };
    try {
      result = await mammoth.convertToHtml({ arrayBuffer: buf });
    } catch {
      throw new Error('This document could not be read. It may be damaged or saved in an older format.');
    }
    return purify.default.sanitize(result.value, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input'] });
  });
  if (loading) return <Loading />;
  if (error) return <PreviewError message={error} onDownload={onDownload} />;
  return (
    <div className="scrollbar-thin h-full overflow-auto p-3 sm:p-6">
      <article
        className="doc-preview mx-auto max-w-3xl rounded-xl bg-white p-6 text-slate-900 shadow-2xl sm:p-10"
        dangerouslySetInnerHTML={{ __html: data || '<p><em>This document has no readable text.</em></p>' }}
      />
      <p className="mx-auto mt-3 max-w-3xl text-center text-xs text-white/50">
        Simplified preview — layout may differ from Word. Download for the original.
      </p>
    </div>
  );
}

export function MediaViewer({
  url,
  kind,
  poster,
  onDownload,
  onReload,
}: {
  url: string;
  kind: 'video' | 'audio';
  poster?: string | null;
  onDownload: () => void;
  /** Fetch a fresh signed URL (e.g. after it expired during a long session). */
  onReload?: () => void;
}) {
  const [failure, setFailure] = useState<{ url: string; code: number } | null>(null);

  if (failure?.url === url) {
    // MEDIA_ERR_SRC_NOT_SUPPORTED (4) / MEDIA_ERR_DECODE (3): the browser can't
    // play this format or codec. Anything else is most likely the network.
    const unsupported = failure.code === 3 || failure.code === 4;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white">
        <AlertTriangle className="size-10 text-orange-400" />
        <p className="font-medium">{unsupported ? `This ${kind} can’t be played in this browser` : `The ${kind} could not be loaded`}</p>
        <p className="max-w-sm text-sm text-white/70">
          {unsupported
            ? kind === 'video'
              ? 'Its format or codec isn’t supported here (for example, HEVC/H.265 videos from iPhones outside Safari). Download it to watch it with your device’s player.'
              : 'Its format isn’t supported here. Download it to play it with your device’s player.'
            : 'Check your connection and try again, or download the file.'}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onDownload} icon={<Download className="size-4" />}>
            Download
          </Button>
          {!unsupported && onReload && (
            <Button variant="secondary" onClick={onReload} icon={<RotateCw className="size-4" />}>
              Try again
            </Button>
          )}
        </div>
      </div>
    );
  }

  const onError = (e: React.SyntheticEvent<HTMLMediaElement>) => setFailure({ url, code: e.currentTarget.error?.code ?? 0 });

  return (
    <div className="flex h-full items-center justify-center p-4">
      {kind === 'video' ? (
        <video
          key={url}
          src={url}
          poster={poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          onError={onError}
          className="max-h-full max-w-full rounded-lg bg-black"
        />
      ) : (
        <audio key={url} src={url} controls preload="metadata" onError={onError} className="w-full max-w-md" />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { HardDrive, LogOut, Menu as MenuIcon, Search, Settings, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, IconButton } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { Avatar } from '@/components/ui/misc';
import { useAuth } from '@/context/AuthContext';
import { useUploads } from '@/context/UploadContext';
import { useAvatarUrl, useDisplayName, useProfile } from '@/hooks/useProfile';
import { findView, PAGE_TITLES } from '@/lib/views';
import { getErrorMessage } from '@/lib/errors';
import { SearchBar } from './SearchBar';

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { openUpload } = useUploads();
  const { data: profile } = useProfile();
  const { data: avatarUrl } = useAvatarUrl(profile?.avatar_path);
  const name = useDisplayName();
  const [mobileSearch, setMobileSearch] = useState(false);

  const title = PAGE_TITLES[location.pathname] ?? 'My Vault';
  useEffect(() => {
    document.title = `${title} · My Vault`;
  }, [title]);
  const view = findView(location.pathname);
  const uploadCategory = view?.uploadCategory ?? 'auto';

  const logout = async () => {
    try {
      await signOut();
    } catch (err) {
      toast.error('Sign out failed', { description: getErrorMessage(err) });
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-6">
        {mobileSearch ? (
          <>
            <SearchBar className="flex-1" autoFocus onDone={() => setMobileSearch(false)} />
            <IconButton label="Close search" onClick={() => setMobileSearch(false)}>
              <X className="size-5" />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton label="Open menu" onClick={onOpenMenu} className="lg:hidden">
              <MenuIcon className="size-5" />
            </IconButton>
            <h1 className="min-w-0 truncate text-lg font-semibold text-ink sm:text-xl">{title}</h1>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <SearchBar className="hidden w-64 md:block lg:w-80" />
              <IconButton label="Search" onClick={() => setMobileSearch(true)} className="md:hidden">
                <Search className="size-5" />
              </IconButton>
              <Button onClick={() => openUpload(uploadCategory)} icon={<Upload className="size-4" />} className="max-sm:size-10 max-sm:px-0" aria-label="Upload files">
                <span className="hidden sm:inline">Upload</span>
              </Button>
              <Menu
                width={220}
                items={[
                  { label: 'Settings', icon: <Settings className="size-4" />, onSelect: () => navigate('/settings') },
                  { label: 'Storage', icon: <HardDrive className="size-4" />, onSelect: () => navigate('/storage') },
                  { label: 'Sign out', icon: <LogOut className="size-4" />, onSelect: logout, separatorBefore: true, danger: true },
                ]}
                trigger={(props) => (
                  <button type="button" {...props} className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" aria-label={`Account menu for ${user?.email ?? name}`}>
                    <Avatar name={name} url={avatarUrl} size={36} />
                  </button>
                )}
              />
            </div>
          </>
        )}
      </div>
    </header>
  );
}

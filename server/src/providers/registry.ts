import { localProvider } from './local.js';
import { googleDriveProvider } from './google-drive.js';
import { yandexDiskProvider } from './yandex-disk.js';
import { oneDriveProvider } from './onedrive.js';
import { protonDriveProvider } from './proton-drive.js';
import { webDavProvider } from './webdav.js';
import type { CloudProvider, ProviderDescriptor } from './types.js';

/**
 * Provider registry. Add a new Drive here and it appears in the UI, the
 * connection wizard and the vault host picker automatically.
 */
const registry = new Map<string, CloudProvider>();

for (const p of [localProvider, googleDriveProvider, protonDriveProvider, yandexDiskProvider, oneDriveProvider, webDavProvider]) {
  registry.set(p.descriptor.id, p);
}

export const getProvider = (id: string): CloudProvider | undefined => registry.get(id);

export const requireProvider = (id: string): CloudProvider => {
  const p = registry.get(id);
  if (!p) throw new Error(`Unknown cloud provider "${id}".`);
  return p;
};

export const allProviders = (): CloudProvider[] => [...registry.values()];

export const providerDescriptors = (): ProviderDescriptor[] => allProviders().map((p) => p.descriptor);

export const providerIds = (): string[] => allProviders().map((p) => p.descriptor.id);

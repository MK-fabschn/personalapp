import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Gleiche Vite-Konfiguration wie die App (SvelteKit-Plugin löst tsconfig und #lib auf).
export default mergeConfig(
	viteConfig,
	defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 } })
);

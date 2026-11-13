<script lang="ts">
	import { page } from '$app/state';
	import Icon from '#lib/components/Icon.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const nav = [
		{ href: '/', label: 'Übersicht', icon: 'home' },
		{ href: '/todos', label: 'To-Dos', icon: 'todo' },
		{ href: '/kalender', label: 'Kalender', icon: 'calendar' },
		{ href: '/training', label: 'Training', icon: 'training' },
		{ href: '/finanzen', label: 'Finanzen', icon: 'finance' },
		{ href: '/journal', label: 'Journal', icon: 'journal' }
	] as const;

	const active = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

<div class="min-h-dvh md:flex">
	<!-- Seitenleiste ab Tablet -->
	<aside class="border-border bg-surface sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r p-4 md:flex">
		<div class="mb-6 px-2 text-xl font-bold tracking-tight">Fabse</div>
		<nav class="flex flex-1 flex-col gap-1">
			{#each nav as item (item.href)}
				<a
					href={item.href}
					class="flex items-center gap-3 rounded-lg px-3 py-2 font-medium transition-colors {active(item.href)
						? 'bg-accent/15 text-accent'
						: 'text-muted hover:bg-surface-2 hover:text-fg'}"
				>
					<Icon name={item.icon} />{item.label}
				</a>
			{/each}
		</nav>
		<form method="POST" action="/logout">
			<button class="text-muted hover:text-fg flex w-full items-center gap-3 rounded-lg px-3 py-2">
				<Icon name="logout" />Abmelden
			</button>
		</form>
	</aside>

	<main class="mx-auto w-full max-w-6xl flex-1 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28 md:px-8 md:pt-8 md:pb-10">
		{@render children()}
	</main>

	<!-- Tab-Leiste am Handy -->
	<nav
		class="border-border bg-surface/90 fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
	>
		{#each nav as item (item.href)}
			<a
				href={item.href}
				class="flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium {active(item.href) ? 'text-accent' : 'text-muted'}"
			>
				<Icon name={item.icon} size={22} />{item.label}
			</a>
		{/each}
	</nav>
</div>

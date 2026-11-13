<script lang="ts">
	import { duration, fmtDateShort, localDate } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const SPORT: Record<string, { label: string; color: string }> = {
		running: { label: 'Laufen', color: '#f97316' },
		cycling: { label: 'Rad', color: '#22c55e' },
		virtual_ride: { label: 'Zwift', color: '#3b82f6' },
		strength: { label: 'Kraft', color: '#a855f7' }
	};
	const sport = (s: string) => SPORT[s] ?? { label: s, color: '#94a3b8' };

	const thisWeek = $derived(data.buckets.at(-1)!);
	const lastWeek = $derived(data.buckets.at(-2)!);
	const maxDur = $derived(Math.max(3600, ...data.buckets.map((b) => b.durationS)));
	const km = (m: number) => (m / 1000).toLocaleString('de-AT', { maximumFractionDigits: 1 });
	const sportsUsed = $derived([...new Set(data.buckets.flatMap((b) => Object.keys(b.bySport)))]);
</script>

<svelte:head><title>Training · Fabse</title></svelte:head>

<h1 class="mb-4 text-2xl font-bold">Training</h1>

<section class="mb-4 grid grid-cols-3 gap-3">
	<div class="card p-4">
		<p class="text-muted text-xs">Diese Woche</p>
		<p class="text-xl font-bold">{duration(thisWeek.durationS)}</p>
		<p class="text-muted text-xs">Vorwoche: {duration(lastWeek.durationS)}</p>
	</div>
	<div class="card p-4">
		<p class="text-muted text-xs">Distanz</p>
		<p class="text-xl font-bold">{km(thisWeek.distanceM)} km</p>
		<p class="text-muted text-xs">Vorwoche: {km(lastWeek.distanceM)} km</p>
	</div>
	<div class="card p-4">
		<p class="text-muted text-xs">Einheiten</p>
		<p class="text-xl font-bold">{thisWeek.count}</p>
		<p class="text-muted text-xs">Vorwoche: {lastWeek.count}</p>
	</div>
</section>

<div class="grid gap-4 lg:grid-cols-2">
	<section class="card p-4">
		<h2 class="mb-3 font-semibold">Trainingszeit – letzte 12 Wochen</h2>
		<div class="flex h-40 items-end gap-1.5">
			{#each data.buckets as b (b.week)}
				<div class="flex h-full flex-1 flex-col justify-end" title="{fmtDateShort(b.week)}: {duration(b.durationS)}">
					{#each Object.entries(b.bySport) as [s, sec] (s)}
						<div style="height:{(sec / maxDur) * 100}%;background:{sport(s).color}" class="first:rounded-t-sm"></div>
					{/each}
					{#if b.durationS === 0}<div class="bg-border h-0.5"></div>{/if}
				</div>
			{/each}
		</div>
		<div class="text-muted mt-1 flex justify-between text-[10px]">
			<span>{fmtDateShort(data.buckets[0].week)}</span><span>diese Woche</span>
		</div>
		{#if sportsUsed.length}
			<div class="mt-3 flex flex-wrap gap-2 text-xs">
				{#each sportsUsed as s (s)}<span class="chip"><span class="size-2 rounded-full" style="background:{sport(s).color}"></span>{sport(s).label}</span>{/each}
			</div>
		{/if}
	</section>

	<section class="card p-4">
		<h2 class="mb-2 font-semibold">Letzte Einheiten</h2>
		{#if data.recent.length === 0}
			<div class="text-muted py-6 text-center text-sm">
				<p>Noch keine Aktivitäten.</p>
				<p class="mt-1">Sobald die Garmin-Anbindung steht, erscheinen sie hier automatisch.</p>
			</div>
		{:else}
			<ul class="divide-border divide-y">
				{#each data.recent as a (a.id)}
					<li class="flex items-center gap-3 py-2">
						<span class="size-2.5 shrink-0 rounded-full" style="background:{sport(a.sport).color}"></span>
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">{a.name ?? sport(a.sport).label}</p>
							<p class="text-muted text-xs">
								{fmtDateShort(localDate(a.startTime))} · {duration(a.durationS)}{a.distanceM ? ` · ${km(a.distanceM)} km` : ''}{a.avgHr ? ` · Ø ${a.avgHr} bpm` : ''}{a.avgPowerW ? ` · Ø ${a.avgPowerW} W` : ''}
							</p>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

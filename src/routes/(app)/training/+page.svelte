<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '#lib/components/Icon.svelte';
	import { duration, fmtDateLong, fmtDateShort, fmtTime, localDate } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let fetching = $state(false);

	const SPORT: Record<string, { label: string; color: string }> = {
		running: { label: 'Laufen', color: '#f97316' },
		cycling: { label: 'Rad', color: '#22c55e' },
		virtual_ride: { label: 'Zwift', color: '#3b82f6' },
		strength: { label: 'Kraft', color: '#a855f7' },
		hiking: { label: 'Wandern', color: '#84cc16' },
		walking: { label: 'Gehen', color: '#14b8a6' },
		resort_skiing: { label: 'Ski', color: '#0ea5e9' },
		resort_skiing_snowboarding_ws: { label: 'Ski', color: '#0ea5e9' },
		bouldering: { label: 'Bouldern', color: '#eab308' },
		breathwork: { label: 'Atemübung', color: '#94a3b8' },
		other: { label: 'Sonstiges', color: '#94a3b8' }
	};
	// Unbekannte Sportarten: Garmins Bezeichnung lesbar machen (lap_swimming → Lap swimming)
	const pretty = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replaceAll('_', ' ');
	const sport = (s: string) => SPORT[s] ?? { label: pretty(s), color: '#94a3b8' };

	const thisWeek = $derived(data.buckets.at(-1)!);
	const lastWeek = $derived(data.buckets.at(-2)!);
	const maxDur = $derived(Math.max(3600, ...data.buckets.map((b) => b.durationS)));
	const km = (m: number) => (m / 1000).toLocaleString('de-AT', { maximumFractionDigits: 1 });
	const sportsUsed = $derived([...new Set(data.buckets.flatMap((b) => Object.keys(b.bySport)))]);
</script>

<svelte:head><title>Training · Fabse</title></svelte:head>

<div class="mb-4 flex flex-wrap items-center gap-2">
	<h1 class="mr-auto text-2xl font-bold">Training</h1>
	{#if data.garmin}
		{#if data.garmin.status}
			<span class="text-muted text-xs">Zuletzt abgerufen: {fmtDateShort(localDate(data.garmin.status.at))} {fmtTime(data.garmin.status.at)}</span>
		{/if}
		<form
			method="POST"
			action="?/fetch"
			use:enhance={() => {
				fetching = true;
				return async ({ update }) => {
					await update();
					fetching = false;
				};
			}}
		>
			<button class="btn" disabled={fetching}><Icon name="sync" size={16} />{fetching ? 'Rufe ab …' : 'Jetzt abrufen'}</button>
		</form>
	{/if}
</div>

{#if form?.error ?? (data.garmin?.status && !data.garmin.status.ok ? data.garmin.status.error : null)}
	<p class="card border-neg mb-4 p-3 text-sm" role="alert">
		<span class="text-neg font-medium">Garmin:</span>
		{form?.error ?? data.garmin?.status?.error}
	</p>
{:else if form && 'added' in form}
	<p class="card mb-4 p-3 text-sm" role="status">
		{form.added === 0 ? 'Keine neuen Einheiten.' : form.added === 1 ? '1 neue Einheit übernommen.' : `${form.added} neue Einheiten übernommen.`}
	</p>
{/if}
{#if data.garmin && data.garmin.expiresInDays !== null && data.garmin.expires}
	<p class="card mb-4 border-amber-500 p-3 text-sm" role="status">
		{#if data.garmin.expiresInDays < 0}
			Der Garmin-Schlüssel ist am {fmtDateLong(data.garmin.expires)} abgelaufen.
		{:else if data.garmin.expiresInDays === 0}
			Der Garmin-Schlüssel läuft heute ab.
		{:else}
			Der Garmin-Schlüssel läuft in {data.garmin.expiresInDays} {data.garmin.expiresInDays === 1 ? 'Tag' : 'Tagen'} ab ({fmtDateLong(data.garmin.expires)}).
		{/if}
		Bitte in Garmin Connect unter Einstellungen → Personal API Token einen neuen erzeugen und am Server in der <code>.env</code> eintragen.
	</p>
{/if}

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
				<p>Noch keine Einheiten.</p>
				<p class="mt-1">
					{data.garmin ? 'Mit „Jetzt abrufen“ kommen sie von Garmin, danach stündlich von selbst.' : 'Sobald ein Garmin-Schlüssel hinterlegt ist, erscheinen sie hier automatisch.'}
				</p>
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

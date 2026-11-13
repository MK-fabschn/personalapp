<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '#lib/components/Icon.svelte';
	import {
		addDays,
		fmtDateLong,
		fmtDateShort,
		fmtMonth,
		fmtTime,
		fmtWeekday,
		localDate,
		localMinutes,
		today,
		viennaToDate
	} from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const HOUR_PX = 48;
	const FIRST_HOUR = 6;
	const t0 = today();

	type Ev = (typeof data.events)[number];

	let showForm = $state(false);
	let editing = $state<Ev | null>(null);
	let formDate = $state(today());
	let formEndDate = $state('');
	let formStart = $state('09:00');
	let formEnd = $state('10:00');
	let allDay = $state(false);
	let repeat = $state<'none' | 'weekly' | 'keep'>('none');
	let syncing = $state(false);

	// Aktionen behalten Ansicht und Datum (?view, ?d) bei, sonst springt der Kalender nach dem Speichern auf heute
	const act = (name: string) => `?/${name}${page.url.search ? '&' + page.url.search.slice(1) : ''}`;

	const days = $derived(Array.from({ length: data.days }, (_, i) => addDays(data.from, i)));
	const writable = $derived(data.calendars.filter((c) => !c.readOnly));
	const defaultCalendarId = $derived((writable.find((c) => c.isDefault) ?? writable[0])?.id);

	/** Termine eines Tages, mit Spalten-Layout bei Überschneidungen */
	function dayLayout(day: string) {
		const dayStart = viennaToDate(day, '00:00').getTime();
		const dayEnd = viennaToDate(addDays(day, 1), '00:00').getTime();
		const timed = data.events
			.filter((e) => !e.allDay && new Date(e.start).getTime() < dayEnd && new Date(e.end).getTime() > dayStart)
			.map((e) => {
				const s = Math.max(new Date(e.start).getTime(), dayStart);
				const en = Math.min(new Date(e.end).getTime(), dayEnd);
				const top = s === dayStart ? 0 : localMinutes(new Date(s));
				const bottom = en === dayEnd ? 1440 : localMinutes(new Date(en));
				return { e, top, bottom: Math.max(bottom, top + 20), col: 0, cols: 1 };
			})
			.sort((a, b) => a.top - b.top);

		// Gruppen sich überschneidender Termine nebeneinander anordnen
		let group: typeof timed = [];
		let groupEnd = -1;
		const flush = () => {
			const cols: number[] = [];
			for (const it of group) {
				let c = cols.findIndex((end) => end <= it.top);
				if (c === -1) c = cols.length;
				cols[c] = it.bottom;
				it.col = c;
			}
			for (const it of group) it.cols = cols.length;
			group = [];
		};
		for (const it of timed) {
			if (it.top >= groupEnd) flush();
			group.push(it);
			groupEnd = Math.max(groupEnd, it.bottom);
		}
		flush();
		return timed;
	}

	const allDayOn = (day: string) => data.events.filter((e) => e.allDay && localDate(e.start) <= day && localDate(new Date(new Date(e.end).getTime() - 1)) >= day);
	const timedOn = (day: string) => dayLayout(day).map((x) => x.e);
	const todosOn = (day: string) => data.todos.filter((td) => td.dueDate === day);
	const freeOn = (day: string) => data.freeDays.find((f) => f.from <= day && f.to >= day);

	const nav = (dir: number) => {
		if (data.view === 'woche') return `?d=${addDays(data.date, dir * 7)}`;
		const [y, m] = data.date.split('-').map(Number);
		return `?view=monat&d=${new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10)}`;
	};
	const title = $derived(
		data.view === 'woche' ? `${fmtDateShort(data.from)} – ${fmtDateShort(addDays(data.from, 6))}` : fmtMonth(data.date.slice(0, 8) + '01')
	);
	const currentMonth = $derived(data.date.slice(0, 7));

	// Farbe des Kalenders: kräftig als Rand, abgeschwächt als Fläche
	const tint = (color: string) => `background:color-mix(in srgb, ${color} 18%, transparent);border-color:${color}`;

	function openForm(day: string, hour?: number) {
		editing = null;
		formDate = day;
		formEndDate = '';
		if (hour !== undefined) {
			formStart = `${String(hour).padStart(2, '0')}:00`;
			allDay = false;
		}
		formEnd = plusHour(formStart);
		repeat = 'none';
		showForm = true;
	}
	function editEvent(e: Ev) {
		if (e.readOnly) return;
		// Schul-Block und Schulweg kommen aus den Einstellungen
		if (e.managedKey?.startsWith('schule:')) return void goto('/kalender/einstellungen#schule');
		editing = e;
		// Bei einer Serie gelten Datum und Uhrzeit für den ersten Termin der Serie
		formDate = localDate(e.seriesStart);
		// Ganztägig: Ende ist die Mitternacht nach dem letzten Tag
		const lastDay = localDate(e.allDay ? new Date(new Date(e.seriesEnd).getTime() - 1) : e.seriesEnd);
		formEndDate = lastDay === formDate ? '' : lastDay;
		allDay = e.allDay;
		formStart = e.allDay ? '09:00' : fmtTime(e.seriesStart);
		formEnd = e.allDay ? '10:00' : fmtTime(e.seriesEnd);
		repeat = e.repeat === 'other' ? 'keep' : e.repeat;
		showForm = true;
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}
	const plusHour = (t: string) => {
		const h = Math.min(23, Number(t.slice(0, 2)) + 1);
		return `${String(h).padStart(2, '0')}:${t.slice(3)}`;
	};

	let scroller = $state<HTMLDivElement>();
	$effect(() => {
		if (scroller) scroller.scrollTop = (8 - FIRST_HOUR) * HOUR_PX;
	});
</script>

<svelte:head><title>Kalender · Fabse</title></svelte:head>

<div class="mb-4 flex flex-wrap items-center gap-2">
	<h1 class="mr-auto text-2xl font-bold">Kalender</h1>
	<div class="bg-surface-2 flex rounded-lg p-1 text-sm font-medium">
		<a href="?d={data.date}" class="rounded-md px-3 py-1 {data.view === 'woche' ? 'bg-surface shadow-sm' : 'text-muted'}">Woche</a>
		<a href="?view=monat&d={data.date}" class="rounded-md px-3 py-1 {data.view === 'monat' ? 'bg-surface shadow-sm' : 'text-muted'}">Monat</a>
	</div>
	<a class="btn px-2.5" href="/kalender/einstellungen" aria-label="Kalender-Einstellungen"><Icon name="settings" size={18} /></a>
	<button class="btn-primary" onclick={() => openForm(t0)}><Icon name="plus" size={18} /><span class="hidden sm:inline">Termin</span></button>
</div>

<div class="mb-3 flex items-center gap-2">
	<a class="btn px-2" href={nav(-1)} aria-label="Zurück"><Icon name="left" size={18} /></a>
	<a class="btn px-2" href={nav(1)} aria-label="Weiter"><Icon name="right" size={18} /></a>
	<a class="btn" href="?{data.view === 'monat' ? 'view=monat&' : ''}d={t0}">Heute</a>
	<h2 class="ml-2 font-semibold">{title}</h2>
</div>

{#if data.sync && !data.sync.ok && data.sync.error}
	<p class="card border-neg mb-3 p-3 text-sm" role="alert"><span class="text-neg font-medium">iCloud-Abgleich:</span> {data.sync.error}</p>
{/if}

<!-- Kalender ein- und ausblenden -->
<div class="mb-3 flex flex-wrap gap-1.5">
	{#each data.calendars as c (c.id)}
		<form method="POST" action={act('toggleCalendar')} use:enhance>
			<input type="hidden" name="id" value={c.id} />
			<input type="hidden" name="visible" value={String(!c.visible)} />
			<button class="chip {c.visible ? '' : 'opacity-50'}" aria-pressed={c.visible} title={c.visible ? `${c.name} ausblenden` : `${c.name} einblenden`}>
				<span class="size-2.5 rounded-full border" style="border-color:{c.color};background:{c.visible ? c.color : 'transparent'}"></span>{c.name}
			</button>
		</form>
	{/each}
	{#if data.sync}
		<form method="POST" action={act('sync')} class="ml-auto" use:enhance={() => { syncing = true; return async ({ update }) => { await update({ reset: false }); syncing = false; }; }}>
			<button class="chip" disabled={syncing} title={data.sync.at ? `Zuletzt abgeglichen: ${fmtTime(data.sync.at)} Uhr` : 'Noch nicht abgeglichen'}>
				<Icon name="sync" size={12} />{syncing ? 'Gleiche ab …' : 'Jetzt abgleichen'}
			</button>
		</form>
	{/if}
</div>

{#if showForm}
	{#key editing?.key ?? 'neu'}
		<form
			method="POST"
			action={act(editing ? 'update' : 'add')}
			class="card mb-4 grid gap-3 p-4 sm:grid-cols-2"
			use:enhance={() => async ({ result, update }) => {
				await update({ reset: false });
				if (result.type === 'success') showForm = false;
			}}
		>
			<h2 class="font-semibold sm:col-span-2">{editing ? (editing.recurring ? 'Serie bearbeiten' : 'Termin bearbeiten') : 'Neuer Termin'}</h2>
			{#if editing}
				<input type="hidden" name="id" value={editing.id} />
				<input type="hidden" name="original" value={new Date(editing.original).toISOString()} />
			{/if}
			<input class="input sm:col-span-2" name="title" placeholder="Titel" aria-label="Titel" value={editing?.title ?? ''} required />
			<label class="space-y-1 text-sm sm:col-span-2">
				<span class="text-muted">Kalender</span>
				<select class="input" name="calendarId" value={editing?.calendarId ?? defaultCalendarId}>
					{#each writable as c (c.id)}<option value={c.id}>{c.name}{c.isDefault ? ' (Standard)' : ''}</option>{/each}
				</select>
			</label>
			<label class="space-y-1 text-sm"><span class="text-muted">{repeat === 'none' ? 'Datum' : 'Erster Termin'}</span><input class="input" type="date" name="date" bind:value={formDate} required /></label>
			<label class="space-y-1 text-sm"><span class="text-muted">Bis (optional)</span><input class="input" type="date" name="endDate" min={formDate} bind:value={formEndDate} /></label>
			<label class="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="allDay" bind:checked={allDay} class="size-4" /> Ganztägig</label>
			{#if !allDay}
				<label class="space-y-1 text-sm"><span class="text-muted">Beginn</span><input class="input" type="time" name="startTime" bind:value={formStart} onchange={() => !editing && (formEnd = plusHour(formStart))} required /></label>
				<label class="space-y-1 text-sm"><span class="text-muted">Ende</span><input class="input" type="time" name="endTime" bind:value={formEnd} required /></label>
			{/if}
			<label class="space-y-1 text-sm">
				<span class="text-muted">Wiederholung</span>
				<select class="input" name="repeat" bind:value={repeat}>
					<option value="none">Keine</option>
					<option value="weekly">Wöchentlich</option>
					{#if editing?.repeat === 'other'}<option value="keep">Wie am iPhone festgelegt</option>{/if}
				</select>
			</label>
			{#if repeat === 'weekly'}
				<label class="space-y-1 text-sm"><span class="text-muted">Serie endet am (optional)</span><input class="input" type="date" name="until" min={formDate} value={editing?.until ?? ''} /></label>
			{:else}
				<span class="hidden sm:block"></span>
			{/if}
			<input class="input" name="location" placeholder="Ort (optional)" aria-label="Ort" value={editing?.location ?? ''} />
			<input class="input" name="notes" placeholder="Notiz (optional)" aria-label="Notiz" value={editing?.notes ?? ''} />
			{#if form?.error}<p class="text-neg text-sm sm:col-span-2" role="alert">{form.error}</p>{/if}
			<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
				{#if editing?.recurring}
					<button class="btn text-neg mr-auto" formaction={act('skip')} formnovalidate>Nur {fmtDateShort(localDate(editing.start))} auslassen</button>
					<button class="btn text-neg" formaction={act('delete')} formnovalidate>Serie löschen</button>
				{:else if editing}
					<button class="btn text-neg mr-auto" formaction={act('delete')} formnovalidate>Löschen</button>
				{/if}
				<button type="button" class="btn" onclick={() => (showForm = false)}>Abbrechen</button>
				<button class="btn-primary">Speichern</button>
			</div>
		</form>
	{/key}
{:else if form?.error}
	<p class="card border-neg text-neg mb-4 p-3 text-sm" role="alert">{form.error}</p>
{/if}

{#snippet eventCard(e: Ev, compact = false)}
	<div class="group flex items-start gap-2">
		<button
			class="min-w-0 flex-1 text-left {e.readOnly ? 'cursor-default' : ''}"
			onclick={() => editEvent(e)}
			aria-label={e.readOnly ? `${e.title} (nur lesbar)` : `${e.title} bearbeiten`}
		>
			<p class="truncate font-medium">{e.title}</p>
			{#if !compact}
				<p class="text-muted truncate text-xs">
					{e.allDay ? 'Ganztägig' : `${fmtTime(e.start)} – ${fmtTime(e.end)}`}{e.location ? ` · ${e.location}` : ''}{e.recurring ? ' · Serie' : ''}
				</p>
			{/if}
		</button>
		{#if !e.readOnly && !e.recurring}
			<form method="POST" action={act('delete')} use:enhance class="opacity-60 group-hover:opacity-100">
				<input type="hidden" name="id" value={e.id} />
				<button class="hover:text-neg p-0.5" aria-label="Termin löschen"><Icon name="trash" size={14} /></button>
			</form>
		{/if}
	</div>
{/snippet}

{#if data.view === 'woche'}
	<!-- Handy: Agenda-Liste -->
	<div class="space-y-3 md:hidden">
		{#each days as day (day)}
			{@const free = freeOn(day)}
			<section class="card p-3 {day === t0 ? 'border-accent' : ''}">
				<button class="mb-1 flex w-full items-baseline justify-between" onclick={() => openForm(day)}>
					<span class="font-semibold {day === t0 ? 'text-accent' : ''}">{fmtDateLong(day)}</span>
					<Icon name="plus" size={16} class="text-muted" />
				</button>
				{#if free}<p class="text-muted mb-1 text-xs">Schulfrei: {free.label}</p>{/if}
				{#each [...allDayOn(day), ...timedOn(day)] as e (e.key)}
					<div class="my-1.5 border-l-2 pl-2" style="border-color:{e.color}">{@render eventCard(e)}</div>
				{/each}
				{#each todosOn(day) as td (td.id)}
					<p class="text-muted my-1 text-sm {td.done ? 'line-through' : ''}">☐ {td.title}</p>
				{/each}
				{#if !allDayOn(day).length && !timedOn(day).length && !todosOn(day).length}
					<p class="text-muted text-sm">Keine Termine</p>
				{/if}
			</section>
		{/each}
	</div>

	<!-- Desktop: Zeitraster -->
	<div class="card hidden overflow-hidden md:block">
		<div class="max-h-[70vh] overflow-y-auto" bind:this={scroller}>
			<div class="border-border bg-surface sticky top-0 z-10 grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b">
				<div></div>
				{#each days as day (day)}
					{@const free = freeOn(day)}
					<div class="border-border border-l p-2 text-center">
						<p class="text-muted text-xs">{fmtWeekday(day)}</p>
						<p class="text-lg font-semibold {day === t0 ? 'text-accent' : ''}">{Number(day.slice(8))}</p>
						<div class="space-y-1 text-left text-xs">
							{#if free}<p class="text-muted truncate" title="Schulfrei: {free.label}">Schulfrei: {free.label}</p>{/if}
							{#each allDayOn(day) as e (e.key)}<div class="rounded border-l-2 px-1.5 py-0.5" style={tint(e.color)}>{@render eventCard(e, true)}</div>{/each}
							{#each todosOn(day) as td (td.id)}<p class="text-muted truncate {td.done ? 'line-through' : ''}">☐ {td.title}</p>{/each}
						</div>
					</div>
				{/each}
			</div>
			<div class="relative grid grid-cols-[56px_repeat(7,minmax(0,1fr))]" style="height:{(24 - FIRST_HOUR) * HOUR_PX}px">
				<div>
					{#each Array.from({ length: 24 - FIRST_HOUR }, (_, i) => i + FIRST_HOUR) as h (h)}
						<div class="text-muted pr-2 text-right text-xs" style="height:{HOUR_PX}px">{h}:00</div>
					{/each}
				</div>
				{#each days as day (day)}
					<div class="border-border relative border-l">
						{#each Array.from({ length: 24 - FIRST_HOUR }, (_, i) => i + FIRST_HOUR) as h (h)}
							<button class="border-border hover:bg-surface-2 block w-full border-t" style="height:{HOUR_PX}px" onclick={() => openForm(day, h)} aria-label="Termin um {h} Uhr anlegen"></button>
						{/each}
						{#each dayLayout(day) as it (it.e.key)}
							{@const top = Math.max(0, (it.top - FIRST_HOUR * 60) / 60) * HOUR_PX}
							{@const height = Math.max(20, ((it.bottom - Math.max(it.top, FIRST_HOUR * 60)) / 60) * HOUR_PX - 2)}
							<div
								class="text-fg absolute overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-xs"
								style="{tint(it.e.color)};top:{top}px;height:{height}px;left:calc({(it.col / it.cols) * 100}% + 2px);width:calc({100 / it.cols}% - 4px)"
							>
								{@render eventCard(it.e, height < 40)}
							</div>
						{/each}
						{#if day === t0}
							{@const nowMin = localMinutes(new Date())}
							{#if nowMin >= FIRST_HOUR * 60}
								<div class="bg-neg pointer-events-none absolute inset-x-0 h-0.5" style="top:{((nowMin - FIRST_HOUR * 60) / 60) * HOUR_PX}px"></div>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		</div>
	</div>
{:else}
	<!-- Monatsansicht -->
	<div class="card overflow-hidden">
		<div class="border-border grid grid-cols-7 border-b">
			{#each days.slice(0, 7) as d (d)}<div class="text-muted p-2 text-center text-xs font-medium">{fmtWeekday(d)}</div>{/each}
		</div>
		<div class="grid grid-cols-7">
			{#each days as day (day)}
				{@const items = [...allDayOn(day), ...timedOn(day)]}
				{@const free = freeOn(day)}
				<a
					href="?d={day}"
					class="border-border hover:bg-surface-2 min-h-16 border-r border-b p-1 sm:min-h-24 sm:p-1.5 {day.slice(0, 7) !== currentMonth ? 'opacity-40' : ''} {free ? 'bg-surface-2' : ''}"
					title={free ? `Schulfrei: ${free.label}` : undefined}
				>
					<span class="inline-grid size-6 place-items-center rounded-full text-sm {day === t0 ? 'bg-accent text-accent-fg font-semibold' : ''}">{Number(day.slice(8))}</span>
					<!-- Handy: nur Punkte -->
					<div class="mt-0.5 flex flex-wrap gap-0.5 sm:hidden">
						{#each items.slice(0, 4) as e (e.key)}<span class="size-1.5 rounded-full" style="background:{e.color}"></span>{/each}
					</div>
					<div class="hidden space-y-0.5 sm:block">
						{#each items.slice(0, 3) as e (e.key)}
							<p class="truncate rounded border-l-2 px-1 text-xs" style={tint(e.color)}>{e.allDay ? '' : fmtTime(e.start) + ' '}{e.title}</p>
						{/each}
						{#if items.length > 3}<p class="text-muted text-xs">+{items.length - 3} weitere</p>{/if}
					</div>
				</a>
			{/each}
		</div>
	</div>
{/if}


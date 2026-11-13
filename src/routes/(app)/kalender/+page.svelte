<script lang="ts">
	import { enhance } from '$app/forms';
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
	const days = $derived(Array.from({ length: data.days }, (_, i) => addDays(data.from, i)));

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

	const nav = (dir: number) => {
		if (data.view === 'woche') return `?d=${addDays(data.date, dir * 7)}`;
		const [y, m] = data.date.split('-').map(Number);
		return `?view=monat&d=${new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10)}`;
	};
	const title = $derived(
		data.view === 'woche' ? `${fmtDateShort(data.from)} – ${fmtDateShort(addDays(data.from, 6))}` : fmtMonth(data.date.slice(0, 8) + '01')
	);
	const currentMonth = $derived(data.date.slice(0, 7));

	function openForm(day: string, hour?: number) {
		editing = null;
		formDate = day;
		formEndDate = '';
		if (hour !== undefined) {
			formStart = `${String(hour).padStart(2, '0')}:00`;
			allDay = false;
		}
		formEnd = plusHour(formStart);
		showForm = true;
	}
	function editEvent(e: Ev) {
		editing = e;
		formDate = localDate(e.start);
		// Ganztägig: Ende ist die Mitternacht nach dem letzten Tag
		const lastDay = localDate(e.allDay ? new Date(new Date(e.end).getTime() - 1) : e.end);
		formEndDate = lastDay === formDate ? '' : lastDay;
		allDay = e.allDay;
		formStart = e.allDay ? '09:00' : fmtTime(e.start);
		formEnd = e.allDay ? '10:00' : fmtTime(e.end);
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
	<button class="btn-primary" onclick={() => openForm(t0)}><Icon name="plus" size={18} /><span class="hidden sm:inline">Termin</span></button>
</div>

<div class="mb-3 flex items-center gap-2">
	<a class="btn px-2" href={nav(-1)} aria-label="Zurück"><Icon name="left" size={18} /></a>
	<a class="btn px-2" href={nav(1)} aria-label="Weiter"><Icon name="right" size={18} /></a>
	<a class="btn" href="?{data.view === 'monat' ? 'view=monat&' : ''}d={t0}">Heute</a>
	<h2 class="ml-2 font-semibold">{title}</h2>
</div>

{#if showForm}
	{#key editing?.id ?? 'neu'}
		<form
			method="POST"
			action={editing ? '?/update' : '?/add'}
			class="card mb-4 grid gap-3 p-4 sm:grid-cols-2"
			use:enhance={() => async ({ result, update }) => {
				await update({ reset: false });
				if (result.type === 'success') showForm = false;
			}}
		>
			<h2 class="font-semibold sm:col-span-2">{editing ? 'Termin bearbeiten' : 'Neuer Termin'}</h2>
			{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
			<input class="input sm:col-span-2" name="title" placeholder="Titel" aria-label="Titel" value={editing?.title ?? ''} required />
			<label class="space-y-1 text-sm"><span class="text-muted">Datum</span><input class="input" type="date" name="date" bind:value={formDate} required /></label>
			<label class="space-y-1 text-sm"><span class="text-muted">Bis (optional)</span><input class="input" type="date" name="endDate" min={formDate} bind:value={formEndDate} /></label>
			<label class="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="allDay" bind:checked={allDay} class="size-4" /> Ganztägig</label>
			{#if !allDay}
				<label class="space-y-1 text-sm"><span class="text-muted">Beginn</span><input class="input" type="time" name="startTime" bind:value={formStart} onchange={() => !editing && (formEnd = plusHour(formStart))} required /></label>
				<label class="space-y-1 text-sm"><span class="text-muted">Ende</span><input class="input" type="time" name="endTime" bind:value={formEnd} required /></label>
			{/if}
			<input class="input" name="location" placeholder="Ort (optional)" aria-label="Ort" value={editing?.location ?? ''} />
			<input class="input" name="notes" placeholder="Notiz (optional)" aria-label="Notiz" value={editing?.notes ?? ''} />
			{#if form?.error}<p class="text-neg text-sm sm:col-span-2">{form.error}</p>{/if}
			<div class="flex justify-end gap-2 sm:col-span-2">
				<button type="button" class="btn" onclick={() => (showForm = false)}>Abbrechen</button>
				<button class="btn-primary">Speichern</button>
			</div>
		</form>
	{/key}
{/if}

{#snippet eventCard(e: Ev, compact = false)}
	<div class="group flex items-start gap-2">
		<button class="min-w-0 flex-1 text-left" onclick={() => editEvent(e)} aria-label="{e.title} bearbeiten">
			<p class="truncate font-medium">{e.title}</p>
			{#if !compact}
				<p class="text-muted truncate text-xs">
					{e.allDay ? 'Ganztägig' : `${fmtTime(e.start)} – ${fmtTime(e.end)}`}{e.location ? ` · ${e.location}` : ''}
				</p>
			{/if}
		</button>
		<form method="POST" action="?/delete" use:enhance class="opacity-60 group-hover:opacity-100">
			<input type="hidden" name="id" value={e.id} />
			<button class="hover:text-neg p-0.5" aria-label="Termin löschen"><Icon name="trash" size={14} /></button>
		</form>
	</div>
{/snippet}

{#if data.view === 'woche'}
	<!-- Handy: Agenda-Liste -->
	<div class="space-y-3 md:hidden">
		{#each days as day (day)}
			<section class="card p-3 {day === t0 ? 'border-accent' : ''}">
				<button class="mb-1 flex w-full items-baseline justify-between" onclick={() => openForm(day)}>
					<span class="font-semibold {day === t0 ? 'text-accent' : ''}">{fmtDateLong(day)}</span>
					<Icon name="plus" size={16} class="text-muted" />
				</button>
				{#each [...allDayOn(day), ...timedOn(day)] as e (e.id)}
					<div class="border-accent my-1.5 border-l-2 pl-2">{@render eventCard(e)}</div>
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
				<div class="border-border border-l p-2 text-center">
					<p class="text-muted text-xs">{fmtWeekday(day)}</p>
					<p class="text-lg font-semibold {day === t0 ? 'text-accent' : ''}">{Number(day.slice(8))}</p>
					<div class="space-y-1 text-left text-xs">
						{#each allDayOn(day) as e (e.id)}<div class="bg-accent/15 text-accent rounded px-1.5 py-0.5">{@render eventCard(e, true)}</div>{/each}
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
						{#each dayLayout(day) as it (it.e.id)}
							{@const top = Math.max(0, (it.top - FIRST_HOUR * 60) / 60) * HOUR_PX}
							{@const height = Math.max(20, ((it.bottom - Math.max(it.top, FIRST_HOUR * 60)) / 60) * HOUR_PX - 2)}
							<div
								class="bg-accent/15 border-accent text-fg absolute overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-xs"
								style="top:{top}px;height:{height}px;left:calc({(it.col / it.cols) * 100}% + 2px);width:calc({100 / it.cols}% - 4px)"
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
				<a
					href="?d={day}"
					class="border-border hover:bg-surface-2 min-h-16 border-r border-b p-1 sm:min-h-24 sm:p-1.5 {day.slice(0, 7) !== currentMonth ? 'opacity-40' : ''}"
				>
					<span class="inline-grid size-6 place-items-center rounded-full text-sm {day === t0 ? 'bg-accent text-accent-fg font-semibold' : ''}">{Number(day.slice(8))}</span>
					<!-- Handy: nur Punkte -->
					<div class="mt-0.5 flex flex-wrap gap-0.5 sm:hidden">
						{#each items.slice(0, 4) as e (e.id)}<span class="bg-accent size-1.5 rounded-full"></span>{/each}
					</div>
					<div class="hidden space-y-0.5 sm:block">
						{#each items.slice(0, 3) as e (e.id)}
							<p class="bg-accent/15 truncate rounded px-1 text-xs">{e.allDay ? '' : fmtTime(e.start) + ' '}{e.title}</p>
						{/each}
						{#if items.length > 3}<p class="text-muted text-xs">+{items.length - 3} weitere</p>{/if}
					</div>
				</a>
			{/each}
		</div>
	</div>
{/if}

<p class="text-muted mt-4 text-xs">iPhone-Sync folgt im nächsten Schritt.</p>

<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '#lib/components/Icon.svelte';
	import { fmtDateShort } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const keep = () =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) =>
			update({ reset: false });
	const range = (from: string, to: string) => (from === to ? fmtDateShort(from) : `${fmtDateShort(from)} – ${fmtDateShort(to)}`);
	const year = (iso: string) => iso.slice(0, 4);
</script>

<svelte:head><title>Kalender-Einstellungen · Fabse</title></svelte:head>

<div class="mb-4 flex items-center gap-2">
	<a class="btn px-2" href="/kalender" aria-label="Zurück zum Kalender"><Icon name="left" size={18} /></a>
	<h1 class="text-2xl font-bold">Kalender-Einstellungen</h1>
</div>

{#if form?.error}<p class="card border-neg text-neg mb-4 p-3 text-sm" role="alert">{form.error}</p>{/if}

<div class="grid items-start gap-4 lg:grid-cols-2">
	<section class="card p-4">
		<h2 class="font-semibold">Kalender</h2>
		<p class="text-muted mb-3 text-sm">Neue Termine ohne Auswahl landen im Standardkalender.</p>
		<ul class="divide-border divide-y">
			{#each data.calendars as c (c.id)}
				<li class="py-3">
					<div class="flex items-center gap-2">
						<span class="size-3 shrink-0 rounded-full" style="background:{c.color}"></span>
						<span class="min-w-0 flex-1 truncate font-medium">{c.name}</span>
						{#if c.readOnly}<span class="chip">freigegeben, nur lesbar</span>{/if}
						{#if c.isDefault}
							<span class="chip text-accent border-accent">Standardkalender</span>
						{:else if !c.readOnly}
							<form method="POST" action="?/setDefault" use:enhance>
								<input type="hidden" name="id" value={c.id} />
								<button class="text-muted hover:text-fg text-xs underline">als Standard</button>
							</form>
						{/if}
						{#if !c.linked && !c.isDefault}
							<form method="POST" action="?/deleteCalendar" use:enhance>
								<input type="hidden" name="id" value={c.id} />
								<button class="text-muted hover:text-neg p-1" aria-label="Kalender {c.name} löschen"><Icon name="trash" size={16} /></button>
							</form>
						{/if}
					</div>
					<form method="POST" action="?/saveCalendar" class="mt-2 flex flex-wrap gap-x-5 gap-y-1 pl-5 text-sm" use:enhance={keep}>
						<input type="hidden" name="id" value={c.id} />
						<label class="flex items-center gap-2">
							<input type="checkbox" name="visible" checked={c.visible} class="size-4" onchange={(e) => e.currentTarget.form?.requestSubmit()} /> in der App anzeigen
						</label>
						<label class="flex items-center gap-2">
							<input type="checkbox" name="syncEnabled" checked={c.syncEnabled} class="size-4" onchange={(e) => e.currentTarget.form?.requestSubmit()} /> mit iCloud abgleichen
						</label>
					</form>
				</li>
			{/each}
		</ul>
		<form method="POST" action="?/addCalendar" class="mt-3 flex gap-2" use:enhance={() => async ({ update }) => update({ reset: true })}>
			<input class="input" name="name" placeholder="Neuer Kalender" aria-label="Name des neuen Kalenders" required />
			<input type="color" name="color" value="#4f46e5" aria-label="Farbe" class="h-10 w-12 shrink-0 cursor-pointer rounded-lg bg-transparent" />
			<button class="btn" aria-label="Kalender anlegen"><Icon name="plus" size={18} /></button>
		</form>
	</section>

	<section class="card p-4">
		<h2 class="font-semibold">Schulfreie Tage</h2>
		<p class="text-muted mb-3 text-sm">An diesen Tagen entfallen Schul-Block und Schulweg.</p>
		{#if data.freeDays.length}
			<ul class="divide-border divide-y">
				{#each data.freeDays as d (d.id)}
					<li class="flex items-center gap-2 py-2">
						<span class="min-w-0 flex-1 truncate">{d.label}</span>
						<span class="text-muted text-sm tabular-nums">{range(d.from, d.to)}{year(d.to)}</span>
						<form method="POST" action="?/deleteFreeDay" use:enhance>
							<input type="hidden" name="id" value={d.id} />
							<button class="text-muted hover:text-neg p-1" aria-label="{d.label} löschen"><Icon name="trash" size={16} /></button>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-muted py-2 text-sm">Noch keine schulfreien Tage eingetragen.</p>
		{/if}
		<form method="POST" action="?/addFreeDay" class="mt-3 grid grid-cols-2 gap-2" use:enhance={() => async ({ update }) => update({ reset: true })}>
			<input class="input col-span-2" name="label" placeholder="z. B. schulautonomer Tag" aria-label="Bezeichnung" required />
			<label class="space-y-1 text-sm"><span class="text-muted">Von</span><input class="input" type="date" name="from" required /></label>
			<label class="space-y-1 text-sm"><span class="text-muted">Bis (optional)</span><input class="input" type="date" name="to" /></label>
			<button class="btn col-span-2"><Icon name="plus" size={18} />Eintragen</button>
		</form>
	</section>

	{#if data.school}
		<section class="card p-4 lg:col-span-2" id="schule">
			<h2 class="font-semibold">Schul-Block und Schulweg</h2>
			<p class="text-muted mb-3 text-sm">
				Wöchentliche Serien im Kalender „Schule“, seit {fmtDateShort(data.school.from)} bis zum letzten Unterrichtstag. Änderungen gelten für die ganze Serie, auch rückwirkend.
			</p>
			<form method="POST" action="?/saveSchool" use:enhance={keep}>
				<div class="overflow-x-auto">
					<table class="w-full min-w-[34rem] text-sm">
						<thead>
							<tr class="text-muted text-left">
								<th class="pb-2 font-normal"></th>
								<th class="pb-2 font-normal">Abfahrt</th>
								<th class="pb-2 font-normal">Schulbeginn</th>
								<th class="pb-2 font-normal">Schulschluss</th>
								<th class="pb-2 font-normal">Ankunft daheim</th>
							</tr>
						</thead>
						<tbody>
							{#each data.weekdays as name, i (name)}
								{@const d = data.school.days[i]}
								<tr>
									<th class="py-1 pr-3 text-left font-medium" scope="row">{name}</th>
									<td class="py-1 pr-2"><input class="input" type="time" name="leave{i}" value={d.leave} aria-label="{name}: Abfahrt" required /></td>
									<td class="py-1 pr-2"><input class="input" type="time" name="start{i}" value={d.start} aria-label="{name}: Schulbeginn" required /></td>
									<td class="py-1 pr-2"><input class="input" type="time" name="end{i}" value={d.end} aria-label="{name}: Schulschluss" required /></td>
									<td class="py-1"><input class="input" type="time" name="home{i}" value={d.home} aria-label="{name}: Ankunft daheim" required /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div class="mt-3 flex flex-wrap items-end gap-3">
					<label class="space-y-1 text-sm"><span class="text-muted">Letzter Unterrichtstag</span><input class="input" type="date" name="lastDay" value={data.school.lastDay} required /></label>
					<button class="btn-primary ml-auto">Zeiten speichern</button>
				</div>
			</form>
		</section>
	{/if}
</div>

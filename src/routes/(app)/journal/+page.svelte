<script lang="ts">
	import { enhance } from '$app/forms';
	import HabitRow from '#lib/components/HabitRow.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { addDays, fmtDateLong } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let text = $state('');
	let dirty = $state(false);
	let saving = $state(false);
	let manage = $state(false);
	$effect(() => {
		text = data.entry;
		dirty = false;
	});
	const doneCount = $derived(data.habits.filter((h) => h.done).length);
</script>

<svelte:head><title>Journal · Fabse</title></svelte:head>

<div class="mb-4 flex items-center justify-between gap-2">
	<a class="btn px-2" href="?d={addDays(data.date, -1)}" aria-label="Voriger Tag"><Icon name="left" size={18} /></a>
	<div class="text-center">
		<h1 class="text-xl font-bold">{data.isToday ? 'Heute' : 'Journal'}</h1>
		<p class="text-muted text-sm">{fmtDateLong(data.date)}</p>
	</div>
	{#if data.isToday}
		<span class="w-10"></span>
	{:else}
		<a class="btn px-2" href="?d={addDays(data.date, 1)}" aria-label="Nächster Tag"><Icon name="right" size={18} /></a>
	{/if}
</div>

<div class="grid gap-4 lg:grid-cols-2">
	<section class="card p-4">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="font-semibold">Gewohnheiten <span class="text-muted font-normal">{doneCount}/{data.habits.length}</span></h2>
			<button class="text-muted text-sm" onclick={() => (manage = !manage)}>{manage ? 'Fertig' : 'Bearbeiten'}</button>
		</div>
		<div class="space-y-2">
			{#each data.habits as h (h.id)}
				<div class="flex items-center gap-2">
					<HabitRow habit={h} date={data.date} showWeek />
					{#if manage}
						<form method="POST" action="?/archiveHabit" use:enhance>
							<input type="hidden" name="id" value={h.id} />
							<button class="text-muted hover:text-neg p-2" aria-label="Gewohnheit entfernen"><Icon name="trash" size={18} /></button>
						</form>
					{/if}
				</div>
			{:else}
				<p class="text-muted py-4 text-center text-sm">Noch keine Gewohnheiten – leg unten welche an.</p>
			{/each}
		</div>
		{#if manage || data.habits.length === 0}
			<form method="POST" action="?/addHabit" class="mt-3 flex gap-2" use:enhance={() => async ({ update }) => update({ reset: true })}>
				<input class="input w-14 text-center" name="icon" placeholder="💧" maxlength="4" />
				<input class="input" name="name" placeholder="z. B. 2 l Wasser trinken" required />
				<button class="btn" aria-label="Hinzufügen"><Icon name="plus" size={18} /></button>
			</form>
			{#if form && 'error' in form && form.error}<p class="text-neg mt-1 text-sm">{form.error}</p>{/if}
		{/if}
	</section>

	<section class="card flex flex-col p-4">
		<h2 class="mb-3 font-semibold">Eintrag</h2>
		<form
			method="POST"
			action="?/save"
			class="flex flex-1 flex-col gap-3"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update({ reset: false });
					saving = false;
					dirty = false;
				};
			}}
		>
			<input type="hidden" name="date" value={data.date} />
			<textarea
				class="input min-h-64 flex-1 resize-y leading-relaxed"
				name="text"
				bind:value={text}
				oninput={() => (dirty = true)}
				placeholder="Wie war dein Tag? Was ist dir gelungen, was nimmst du mit?"
			></textarea>
			<div class="flex items-center justify-end gap-3">
				<span class="text-muted text-sm">{saving ? 'Speichere …' : dirty ? 'Nicht gespeichert' : form && 'saved' in form ? 'Gespeichert ✓' : ''}</span>
				<button class="btn-primary" disabled={saving || !dirty}>Speichern</button>
			</div>
		</form>
	</section>
</div>

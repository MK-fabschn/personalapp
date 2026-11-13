<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';

	// Formulare zielen evtl. auf eine andere Seite (z. B. vom Dashboard aus):
	// nicht dorthin navigieren, sondern nur die Daten neu laden.
	const stay = () => async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
		if (result.type === 'success') await invalidateAll();
		else await update();
	};
	import Icon from './Icon.svelte';

	type Habit = { id: number; name: string; icon: string; done: boolean; streak: number; week?: { day: string; done: boolean }[] };
	let { habit, date, action = '/journal', showWeek = false }: { habit: Habit; date: string; action?: string; showWeek?: boolean } = $props();
</script>

<form method="POST" action="{action}?/toggle" use:enhance={stay} class="w-full">
	<input type="hidden" name="habitId" value={habit.id} />
	<input type="hidden" name="date" value={date} />
	<input type="hidden" name="done" value={String(!habit.done)} />
	<button
		class="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors {habit.done
			? 'border-accent bg-accent/10'
			: 'border-border bg-surface-2'}"
	>
		<span class="text-xl">{habit.icon}</span>
		<span class="flex-1">
			<span class="block font-medium">{habit.name}</span>
			{#if habit.streak > 0}<span class="text-muted text-xs">🔥 {habit.streak} {habit.streak === 1 ? 'Tag' : 'Tage'} in Folge</span>{/if}
		</span>
		{#if showWeek && habit.week}
			<span class="hidden gap-1 sm:flex">
				{#each habit.week as w (w.day)}<span class="size-2.5 rounded-full {w.done ? 'bg-accent' : 'bg-border'}"></span>{/each}
			</span>
		{/if}
		<span class="grid size-6 place-items-center rounded-full border-2 {habit.done ? 'border-accent bg-accent text-accent-fg' : 'border-border'}">
			{#if habit.done}<Icon name="check" size={14} />{/if}
		</span>
	</button>
</form>

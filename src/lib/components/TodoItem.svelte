<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Icon from './Icon.svelte';
	import { PRIORITIES, fmtDateShort, today } from '#lib/format.js';

	type Todo = {
		id: number;
		title: string;
		notes: string | null;
		dueDate: string | null;
		priority: number;
		categoryId: number | null;
		done: boolean;
	};
	type Category = { id: number; name: string; color: string };

	let {
		todo,
		categories = [],
		action = '/todos',
		deletable = true
	}: { todo: Todo; categories?: Category[]; action?: string; deletable?: boolean } = $props();

	let editing = $state(false);
	let error = $state('');

	// Formulare zielen evtl. auf eine andere Seite (z. B. vom Dashboard aus):
	// nicht dorthin navigieren, sondern nur die Daten neu laden.
	const stay = () => async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
		if (result.type === 'success') await invalidateAll();
		else await update();
	};
	const save = () => async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
		if (result.type === 'success') {
			await invalidateAll();
			editing = false;
			error = '';
		} else {
			error = String(result.data?.error ?? 'Speichern ist fehlgeschlagen.');
		}
	};

	const cat = $derived(categories.find((c) => c.id === todo.categoryId));
	const prio = $derived(PRIORITIES.find((p) => p.value === todo.priority));
	const overdue = $derived(!todo.done && todo.dueDate !== null && todo.dueDate < today());
	const isToday = $derived(todo.dueDate === today());
</script>

{#if editing}
	<li class="py-2.5">
		<form method="POST" action="{action}?/update" class="space-y-2" use:enhance={save}>
			<input type="hidden" name="id" value={todo.id} />
			<input class="input" name="title" value={todo.title} aria-label="Titel" required />
			<textarea class="input" name="notes" rows="2" placeholder="Notiz (optional)" aria-label="Notiz" value={todo.notes ?? ''}></textarea>
			<div class="grid grid-cols-2 gap-2">
				<label class="space-y-1 text-sm"><span class="text-muted">Fällig</span><input class="input" type="date" name="dueDate" value={todo.dueDate ?? ''} /></label>
				<label class="space-y-1 text-sm">
					<span class="text-muted">Priorität</span>
					<select class="input" name="priority" value={todo.priority}>
						{#each PRIORITIES as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
					</select>
				</label>
				<label class="col-span-2 space-y-1 text-sm">
					<span class="text-muted">Kategorie</span>
					<select class="input" name="categoryId" value={todo.categoryId ?? ''}>
						<option value="">Keine Kategorie</option>
						{#each categories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
					</select>
				</label>
			</div>
			{#if error}<p class="text-neg text-sm">{error}</p>{/if}
			<div class="flex justify-end gap-2">
				<button type="button" class="btn" onclick={() => ((editing = false), (error = ''))}>Abbrechen</button>
				<button class="btn-primary">Speichern</button>
			</div>
		</form>
	</li>
{:else}
	<li class="flex items-start gap-3 py-2.5">
		<form method="POST" action="{action}?/toggle" use:enhance={stay}>
			<input type="hidden" name="id" value={todo.id} />
			<input type="hidden" name="done" value={String(!todo.done)} />
			<button
				class="mt-0.5 grid size-5 place-items-center rounded-md border-2 {todo.done
					? 'border-accent bg-accent text-accent-fg'
					: 'border-border'}"
				aria-label={todo.done ? 'Als offen markieren' : 'Erledigt'}
			>
				{#if todo.done}<Icon name="check" size={14} />{/if}
			</button>
		</form>
		<div class="min-w-0 flex-1">
			<p class="leading-snug {todo.done ? 'text-muted line-through' : ''}">{todo.title}</p>
			{#if todo.notes}<p class="text-muted truncate text-sm">{todo.notes}</p>{/if}
			<div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
				{#if todo.dueDate}
					<span class="chip {overdue ? 'text-neg' : isToday ? 'text-accent' : ''}">
						{isToday ? 'Heute' : fmtDateShort(todo.dueDate)}
					</span>
				{/if}
				{#if prio && todo.priority !== 2}<span class="chip {prio.cls}">{prio.label}</span>{/if}
				{#if cat}
					<span class="chip"><span class="size-2 rounded-full" style="background:{cat.color}"></span>{cat.name}</span>
				{/if}
			</div>
		</div>
		<button class="text-muted hover:text-fg p-1" aria-label="Bearbeiten" onclick={() => (editing = true)}><Icon name="edit" size={16} /></button>
		{#if deletable}
			<form method="POST" action="{action}?/delete" use:enhance={stay}>
				<input type="hidden" name="id" value={todo.id} />
				<button class="text-muted hover:text-neg p-1" aria-label="Löschen"><Icon name="trash" size={16} /></button>
			</form>
		{/if}
	</li>
{/if}

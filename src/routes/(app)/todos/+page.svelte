<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '#lib/components/Icon.svelte';
	import TodoItem from '#lib/components/TodoItem.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let showCats = $state(false);

	const link = (show: string, kat: number | null) => {
		const p = new URLSearchParams();
		if (show !== 'offen') p.set('show', show);
		if (kat) p.set('kat', String(kat));
		const q = p.toString();
		return q ? `?${q}` : '?';
	};
</script>

<svelte:head><title>To-Dos · Fabse</title></svelte:head>

<h1 class="mb-4 text-2xl font-bold">To-Dos</h1>

<div class="grid gap-4 lg:grid-cols-[1fr_320px]">
	<section class="card min-w-0 p-4">
		<div class="mb-2 flex flex-wrap items-center gap-2">
			<a href={link('offen', data.cat)} class="chip {data.show === 'offen' ? 'text-accent border-accent' : ''}">Offen</a>
			<a href={link('erledigt', data.cat)} class="chip {data.show === 'erledigt' ? 'text-accent border-accent' : ''}">Erledigt</a>
			<span class="bg-border mx-1 h-4 w-px"></span>
			<a href={link(data.show, null)} class="chip {!data.cat ? 'text-accent border-accent' : ''}">Alle</a>
			{#each data.categories as c (c.id)}
				<a href={link(data.show, c.id)} class="chip {data.cat === c.id ? 'text-accent border-accent' : ''}">
					<span class="size-2 rounded-full" style="background:{c.color}"></span>{c.name}
				</a>
			{/each}
		</div>

		{#if data.todos.length === 0}
			<p class="text-muted py-8 text-center">{data.show === 'offen' ? 'Nichts offen 🎉' : 'Noch nichts erledigt.'}</p>
		{:else}
			<ul class="divide-border divide-y">
				{#each data.todos as todo (todo.id)}
					<TodoItem {todo} categories={data.categories} />
				{/each}
			</ul>
		{/if}
	</section>

	<aside class="order-first min-w-0 space-y-4 lg:order-none">
		<form method="POST" action="?/add" class="card space-y-3 p-4" use:enhance={() => async ({ update }) => update({ reset: true })}>
			<h2 class="font-semibold">Neues To-Do</h2>
			<input class="input" name="title" placeholder="Was ist zu tun?" required />
			<textarea class="input" name="notes" rows="2" placeholder="Notiz (optional)"></textarea>
			<div class="grid grid-cols-2 gap-2">
				<label class="space-y-1 text-sm"><span class="text-muted">Fällig</span><input class="input" type="date" name="dueDate" /></label>
				<label class="space-y-1 text-sm">
					<span class="text-muted">Priorität</span>
					<select class="input" name="priority">
						<option value="1">Hoch</option>
						<option value="2" selected>Mittel</option>
						<option value="3">Niedrig</option>
					</select>
				</label>
			</div>
			<select class="input" name="categoryId">
				<option value="">Keine Kategorie</option>
				{#each data.categories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
			</select>
			{#if form?.error}<p class="text-neg text-sm">{form.error}</p>{/if}
			<button class="btn-primary w-full"><Icon name="plus" size={18} />Hinzufügen</button>
		</form>

		<div class="card p-4">
			<button class="flex w-full items-center justify-between font-semibold" onclick={() => (showCats = !showCats)}>
				Kategorien <span class="text-muted text-sm">{showCats ? 'schließen' : 'bearbeiten'}</span>
			</button>
			{#if showCats}
				<ul class="mt-3 space-y-1">
					{#each data.categories as c (c.id)}
						<li class="flex items-center gap-2">
							<!-- Name und Farbe direkt ändern: speichert beim Verlassen des Feldes -->
							<form method="POST" action="?/updateCategory" class="flex min-w-0 flex-1 items-center gap-2" use:enhance={() => async ({ update }) => update({ reset: false })}>
								<input type="hidden" name="id" value={c.id} />
								<input type="color" name="color" value={c.color} aria-label="Farbe von {c.name}" class="size-7 shrink-0 cursor-pointer rounded bg-transparent" onchange={(e) => e.currentTarget.form?.requestSubmit()} />
								<input class="input py-1" name="name" value={c.name} aria-label="Name der Kategorie" required onchange={(e) => e.currentTarget.form?.requestSubmit()} />
							</form>
							<form method="POST" action="?/deleteCategory" use:enhance>
								<input type="hidden" name="id" value={c.id} />
								<button class="text-muted hover:text-neg p-1" aria-label="Kategorie {c.name} löschen"><Icon name="trash" size={16} /></button>
							</form>
						</li>
					{/each}
				</ul>
				<form method="POST" action="?/addCategory" class="mt-3 flex gap-2" use:enhance={() => async ({ update }) => update({ reset: true })}>
					<input class="input" name="name" placeholder="Neue Kategorie" required />
					<input type="color" name="color" value="#6366f1" class="h-10 w-12 shrink-0 cursor-pointer rounded-lg bg-transparent" />
					<button class="btn" aria-label="Kategorie hinzufügen"><Icon name="plus" size={18} /></button>
				</form>
			{/if}
		</div>
	</aside>
</div>

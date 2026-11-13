<script lang="ts">
	import HabitRow from '#lib/components/HabitRow.svelte';
	import TodoItem from '#lib/components/TodoItem.svelte';
	import { addDays, duration, fmtDateLong, fmtTime, localDate, money } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const hour = Number(new Intl.DateTimeFormat('de-AT', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Vienna' }).format(new Date()));
	const greeting = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Servus' : 'Guten Abend';

	const total = $derived(data.accounts.reduce((s, a) => s + a.balanceCents, 0));
	const habitsDone = $derived(data.habits.filter((h) => h.done).length);
	const week = $derived(data.training.at(-1)!);
	const tomorrow = $derived(addDays(data.today, 1));
	const eventsToday = $derived(data.events.filter((e) => localDate(e.start) <= data.today && localDate(new Date(new Date(e.end).getTime() - 1)) >= data.today));
	const eventsTomorrow = $derived(data.events.filter((e) => localDate(e.start) === tomorrow));
</script>

<svelte:head><title>Fabse</title></svelte:head>

<header class="mb-5">
	<p class="text-muted text-sm">{fmtDateLong(data.today)}</p>
	<h1 class="text-2xl font-bold">{greeting}, Fabian!</h1>
</header>

<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
	<!-- To-Dos -->
	<section class="card p-4 xl:row-span-2">
		<div class="mb-1 flex items-baseline justify-between">
			<h2 class="font-semibold">To-Dos</h2>
			<a href="/todos" class="text-accent text-sm">{data.openCount} offen →</a>
		</div>
		{#if data.todos.length}
			<ul class="divide-border divide-y">
				{#each data.todos as todo (todo.id)}<TodoItem {todo} categories={data.categories} deletable={false} />{/each}
			</ul>
		{:else}
			<p class="text-muted py-6 text-center text-sm">Für heute nichts Dringendes 🎉</p>
		{/if}
	</section>

	<!-- Termine -->
	<section class="card p-4">
		<div class="mb-2 flex items-baseline justify-between">
			<h2 class="font-semibold">Termine</h2>
			<a href="/kalender" class="text-accent text-sm">Kalender →</a>
		</div>
		{#each [['Heute', eventsToday], ['Morgen', eventsTomorrow]] as const as [label, list] (label)}
			<p class="text-muted mt-2 text-xs font-medium uppercase">{label}</p>
			{#each list as e (e.key)}
				<div class="flex gap-3 py-1">
					<span class="text-muted w-12 shrink-0 text-sm tabular-nums">{e.allDay ? 'ganzt.' : fmtTime(e.start)}</span>
					<span class="truncate">{e.title}</span>
				</div>
			{:else}
				<p class="text-muted py-1 text-sm">Keine Termine</p>
			{/each}
		{/each}
	</section>

	<!-- Habits -->
	<section class="card p-4">
		<div class="mb-2 flex items-baseline justify-between">
			<h2 class="font-semibold">Gewohnheiten <span class="text-muted font-normal">{habitsDone}/{data.habits.length}</span></h2>
			<a href="/journal" class="text-accent text-sm">Journal →</a>
		</div>
		<div class="space-y-2">
			{#each data.habits as h (h.id)}<HabitRow habit={h} date={data.today} />{:else}<p class="text-muted text-sm">Noch keine Gewohnheiten angelegt.</p>{/each}
		</div>
	</section>

	<!-- Finanzen -->
	<section class="card p-4">
		<div class="mb-2 flex items-baseline justify-between">
			<h2 class="font-semibold">Finanzen</h2>
			<a href="/finanzen" class="text-accent text-sm">Details →</a>
		</div>
		<p class="mb-2 text-2xl font-bold tabular-nums">{money(total)}</p>
		<ul class="space-y-1 text-sm">
			{#each data.accounts as a (a.id)}
				<li class="flex items-center gap-2">
					<span class="size-2 rounded-full" style="background:{a.color}"></span>
					<span class="flex-1">{a.name}</span>
					<span class="tabular-nums {a.balanceCents < 0 ? 'text-neg' : ''}">{money(a.balanceCents)}</span>
				</li>
			{/each}
		</ul>
	</section>

	<!-- Training -->
	<section class="card p-4">
		<div class="mb-2 flex items-baseline justify-between">
			<h2 class="font-semibold">Training diese Woche</h2>
			<a href="/training" class="text-accent text-sm">Statistik →</a>
		</div>
		<div class="grid grid-cols-3 gap-2 text-center">
			<div><p class="text-lg font-bold">{duration(week.durationS)}</p><p class="text-muted text-xs">Zeit</p></div>
			<div><p class="text-lg font-bold">{(week.distanceM / 1000).toLocaleString('de-AT', { maximumFractionDigits: 1 })} km</p><p class="text-muted text-xs">Distanz</p></div>
			<div><p class="text-lg font-bold">{week.count}</p><p class="text-muted text-xs">Einheiten</p></div>
		</div>
	</section>
</div>

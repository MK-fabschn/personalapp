<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '#lib/components/Icon.svelte';
	import { fmtDateShort, fmtMonth, money, today } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let mode = $state<'out' | 'in' | 'transfer'>('out');
	let editing = $state<number | null>(null);
	let showNewAccount = $state(false);

	const total = $derived(data.accounts.reduce((s, a) => s + a.balanceCents, 0));
	const accName = (id: number) => data.accounts.find((a) => a.id === id)?.name ?? '?';
	const shiftMonth = (m: string, d: number) => {
		const [y, mo] = m.split('-').map(Number);
		const x = new Date(Date.UTC(y, mo - 1 + d, 1));
		return x.toISOString().slice(0, 7);
	};
	const maxCat = $derived(Math.max(1, ...data.byCategory.map((c) => -c.cents)));
	const kindLabel: Record<string, string> = { bank: 'Girokonto', savings: 'Sparkonto', cash: 'Bargeld' };
	const reset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: true });
</script>

<svelte:head><title>Finanzen · Fabse</title></svelte:head>

<div class="mb-4 flex items-end justify-between gap-2">
	<div>
		<h1 class="text-2xl font-bold">Finanzen</h1>
		<p class="text-muted text-sm">Gesamt: <span class="text-fg font-semibold">{money(total)}</span></p>
	</div>
</div>

<!-- Konten -->
<section class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
	{#each data.accounts as a (a.id)}
		<div class="card relative overflow-hidden p-4">
			<span class="absolute inset-y-0 left-0 w-1" style="background:{a.color}"></span>
			<p class="text-muted text-xs">{kindLabel[a.kind] ?? a.kind}</p>
			<p class="font-medium">{a.name}</p>
			{#if editing === a.id}
				<form method="POST" action="?/setBalance" class="mt-2 flex gap-1" use:enhance={() => async ({ update }) => { await update(); editing = null; }}>
					<input type="hidden" name="accountId" value={a.id} />
					<input class="input py-1" name="balance" inputmode="decimal" value={(a.balanceCents / 100).toFixed(2).replace('.', ',')} />
					<button class="btn px-2" aria-label="Speichern"><Icon name="check" size={16} /></button>
				</form>
			{:else}
				<button class="mt-1 text-left text-xl font-bold tabular-nums {a.balanceCents < 0 ? 'text-neg' : ''}" onclick={() => (editing = a.id)} title="Kontostand abgleichen">
					{money(a.balanceCents)}
				</button>
			{/if}
		</div>
	{/each}
</section>

<div class="grid gap-4 lg:grid-cols-[1fr_340px]">
	<div class="min-w-0 space-y-4">
		<!-- Monatsübersicht -->
		<section class="card p-4">
			<div class="mb-3 flex items-center justify-between">
				<a class="btn px-2" href="?m={shiftMonth(data.month, -1)}" aria-label="Voriger Monat"><Icon name="left" size={18} /></a>
				<h2 class="font-semibold">{fmtMonth(data.month + '-01')}</h2>
				<a class="btn px-2" href="?m={shiftMonth(data.month, 1)}" aria-label="Nächster Monat"><Icon name="right" size={18} /></a>
			</div>
			<div class="grid grid-cols-3 gap-2 text-center">
				<div><p class="text-muted text-xs">Einnahmen</p><p class="text-pos font-semibold tabular-nums">{money(data.income)}</p></div>
				<div><p class="text-muted text-xs">Ausgaben</p><p class="text-neg font-semibold tabular-nums">{money(-data.expense)}</p></div>
				<div><p class="text-muted text-xs">Saldo</p><p class="font-semibold tabular-nums">{money(data.income + data.expense)}</p></div>
			</div>
			{#if data.byCategory.length}
				<div class="mt-4 space-y-2">
					{#each data.byCategory as c (c.category)}
						<div class="text-sm">
							<div class="flex justify-between"><span>{c.category}</span><span class="tabular-nums">{money(-c.cents)}</span></div>
							<div class="bg-surface-2 mt-1 h-1.5 rounded-full"><div class="bg-neg h-full rounded-full" style="width:{(-c.cents / maxCat) * 100}%"></div></div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Buchungen -->
		<section class="card p-4">
			<h2 class="mb-2 font-semibold">Buchungen</h2>
			{#if data.txs.length === 0}
				<p class="text-muted py-6 text-center">Keine Buchungen in diesem Monat.</p>
			{:else}
				<ul class="divide-border divide-y">
					{#each data.txs as tx (tx.id)}
						<li class="flex items-center gap-3 py-2">
							<span class="text-muted w-12 shrink-0 text-xs tabular-nums">{fmtDateShort(tx.date)}</span>
							<div class="min-w-0 flex-1">
								<p class="truncate">{tx.description}</p>
								<p class="text-muted text-xs">{accName(tx.accountId)}{tx.category ? ` · ${tx.category}` : ''}</p>
							</div>
							<span class="font-medium tabular-nums {tx.transferId ? 'text-muted' : tx.amountCents > 0 ? 'text-pos' : ''}">
								{tx.amountCents > 0 ? '+' : ''}{money(tx.amountCents)}
							</span>
							<form method="POST" action="?/deleteTx" use:enhance>
								<input type="hidden" name="id" value={tx.id} />
								<button class="text-muted hover:text-neg p-1" aria-label="Buchung löschen"><Icon name="trash" size={16} /></button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	<!-- am Handy steht das Eingabeformular ganz oben -->
	<aside class="order-first min-w-0 space-y-4 lg:order-none">
		<!-- Neue Buchung -->
		<div class="card p-4">
			<div class="bg-surface-2 mb-3 grid grid-cols-3 gap-1 rounded-lg p-1 text-sm font-medium">
				{#each [['out', 'Ausgabe'], ['in', 'Einnahme'], ['transfer', 'Umbuchung']] as [k, l] (k)}
					<button class="rounded-md py-1.5 {mode === k ? 'bg-surface shadow-sm' : 'text-muted'}" onclick={() => (mode = k as typeof mode)}>{l}</button>
				{/each}
			</div>

			{#if mode === 'transfer'}
				<form method="POST" action="?/transfer" class="space-y-3" use:enhance={reset}>
					<div class="grid grid-cols-2 gap-2">
						<label class="space-y-1 text-sm"><span class="text-muted">Von</span>
							<select class="input" name="from">{#each data.accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}</select></label>
						<label class="space-y-1 text-sm"><span class="text-muted">Nach</span>
							<select class="input" name="to">{#each data.accounts as a, i (a.id)}<option value={a.id} selected={i === 1}>{a.name}</option>{/each}</select></label>
					</div>
					<input class="input" name="amount" inputmode="decimal" placeholder="Betrag in €" required />
					<input class="input" name="description" placeholder="z. B. Bankomat" />
					<input class="input" type="date" name="date" value={today()} />
					{#if form?.error}<p class="text-neg text-sm">{form.error}</p>{/if}
					<button class="btn-primary w-full">Umbuchen</button>
				</form>
			{:else}
				<form method="POST" action="?/addTx" class="space-y-3" use:enhance={reset}>
					<input type="hidden" name="type" value={mode} />
					<input class="input text-lg font-semibold" name="amount" inputmode="decimal" placeholder="Betrag in €" required />
					<input class="input" name="description" placeholder={mode === 'in' ? 'z. B. Taschengeld' : 'z. B. Billa'} required />
					<input class="input" name="category" list="cats" placeholder="Kategorie" />
					<datalist id="cats">{#each data.knownCategories as c (c)}<option value={c}></option>{/each}</datalist>
					<div class="grid grid-cols-2 gap-2">
						<select class="input" name="accountId">{#each data.accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}</select>
						<input class="input" type="date" name="date" value={today()} />
					</div>
					{#if form?.error}<p class="text-neg text-sm">{form.error}</p>{/if}
					<button class="btn-primary w-full">{mode === 'in' ? 'Einnahme speichern' : 'Ausgabe speichern'}</button>
				</form>
			{/if}
		</div>

		<div class="card p-4">
			<button class="flex w-full items-center justify-between font-semibold" onclick={() => (showNewAccount = !showNewAccount)}>
				Konto hinzufügen <Icon name="plus" size={18} />
			</button>
			{#if showNewAccount}
				<form method="POST" action="?/addAccount" class="mt-3 space-y-2" use:enhance={reset}>
					<input class="input" name="name" placeholder="Name" required />
					<div class="grid grid-cols-[1fr_auto] gap-2">
						<select class="input" name="kind"><option value="bank">Girokonto</option><option value="savings">Sparkonto</option><option value="cash">Bargeld</option></select>
						<input type="color" name="color" value="#10b981" class="h-10 w-12 rounded-lg bg-transparent" />
					</div>
					<input class="input" name="initial" inputmode="decimal" placeholder="Startguthaben in €" />
					<button class="btn w-full">Anlegen</button>
				</form>
			{/if}
			<p class="text-muted mt-2 text-xs">Tipp: Auf einen Kontostand tippen, um ihn mit der Bank abzugleichen.</p>
		</div>
	</aside>
</div>

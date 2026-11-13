<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let loading = $state(false);
</script>

<svelte:head><title>Login · Fabse</title></svelte:head>

<main class="grid min-h-dvh place-items-center p-6">
	<form
		method="POST"
		class="card w-full max-w-sm space-y-4 p-6"
		use:enhance={() => {
			loading = true;
			return async ({ update }) => {
				await update();
				loading = false;
			};
		}}
	>
		<div>
			<h1 class="text-2xl font-semibold">Fabse</h1>
			<p class="text-muted text-sm">Bitte einloggen.</p>
		</div>
		<label class="block space-y-1">
			<span class="text-sm font-medium">Passwort</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="input" type="password" name="password" autocomplete="current-password" required autofocus />
		</label>
		{#if form?.error}<p class="text-sm text-red-500">{form.error}</p>{/if}
		<button class="btn-primary w-full" disabled={loading}>{loading ? 'Prüfe …' : 'Einloggen'}</button>
	</form>
</main>

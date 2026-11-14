<script>
  import '../app.css';
  import { initializeLocale } from '$lib/i18n';
  onMount(initializeLocale);
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  import { themePreference } from '$lib/stores/theme';
  import DeploymentNotice from '$lib/components/DeploymentNotice.svelte';
  // Self-hosted instances and browser tests can run without sending analytics.
  // This isolated experiment is offline by default; analytics are disabled.
  let { children } = $props();
</script>

{@render children()}
<DeploymentNotice />

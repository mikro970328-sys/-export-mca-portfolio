import {desktopIntegrationFixture} from './figma-desktop-integration-fixture.mjs';

// Kept as the shared fixture name used by the navigation acceptance spec.
// It now serves the real ERP shell, which intentionally has no Help screen.
export function helpCenterFixture({master=true}={}) {
  return desktopIntegrationFixture('account',{master,permissions:master?undefined:[]});
}

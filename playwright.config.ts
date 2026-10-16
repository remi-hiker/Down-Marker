import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'test',testMatch:'browser.spec.ts',use:{headless:true},webServer:{command:'node test/server.mjs',url:'http://127.0.0.1:4179',reuseExistingServer:false}});

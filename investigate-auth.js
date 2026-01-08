import { chromium } from 'playwright';
import fs from 'fs';

const findings = {
  timestamp: new Date().toISOString(),
  requests: [],
  tokenSources: [],
  tokens: [],
  cookies: [],
  localStorage: {},
  sessionStorage: {},
  authMechanism: null,
  authFlow: [],
};

async function investigate() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Intercept all requests to log headers
  page.on('request', request => {
    const url = request.url();
    const headers = request.headers();

    if (url.includes('producer.ai') || url.includes('accounts.google')) {
      const requestInfo = {
        url,
        method: request.method(),
        headers: {
          'authorization': headers['authorization'],
          'content-type': headers['content-type'],
        },
      };
      findings.requests.push(requestInfo);

      if (headers['authorization']) {
        console.log(`✅ Auth Header Found: ${headers['authorization'].substring(0, 50)}...`);
        findings.authMechanism = headers['authorization'].split(' ')[0];
        findings.tokens.push(headers['authorization']);
      }
    }
  });

  // Intercept responses to find tokens
  page.on('response', response => {
    const url = response.url();
    const status = response.status();

    // Track all API calls
    if ((url.includes('producer.ai') || url.includes('supabase') || url.includes('discord')) && url.includes('api')) {
      findings.authFlow.push({
        timestamp: new Date().toISOString(),
        url,
        status,
        statusText: response.statusText(),
      });
    }

    // Deep inspection of potential token endpoints
    if (url.includes('producer.ai') || url.includes('supabase')) {
      response.json().then(json => {
        // Check for tokens in response body
        if (json.token || json.access_token || json.accessToken || json.session || json.user) {
          console.log(`\n✅ Token Source Found: ${url}`);
          console.log(`   Status: ${status}`);

          const tokenSource = {
            url,
            status,
            timestamp: new Date().toISOString(),
            responseKeys: Object.keys(json),
            hasToken: !!(json.token || json.access_token || json.accessToken),
            tokenValue: json.token || json.access_token || json.accessToken || null,
          };

          findings.tokenSources.push(tokenSource);
          findings.tokens.push(json.token || json.access_token || json.accessToken);

          console.log(`   Keys in response: ${Object.keys(json).join(', ')}`);
        }
      }).catch(() => {
        // Not JSON
      });
    }
  });

  console.log('🔍 Starting authentication investigation...\n');
  console.log('1. Navigating to producer.ai');

  try {
    await page.goto('https://www.producer.ai', { waitUntil: 'networkidle' });
  } catch (e) {
    console.log('⚠️  Navigation timeout (expected)');
  }

  // Wait for user to complete Google OAuth
  console.log('\n2. Waiting for Google OAuth flow...');
  console.log('   Please complete the login in the browser window');
  console.log('   I will capture authentication details...\n');

  // Wait until the API endpoint is called (pagination endpoint)
  await page.waitForURL('**/producer.ai/**', { timeout: 120000 }).catch(() => {
    console.log('⚠️  URL wait timeout');
  });

  // Give time for API calls to complete
  console.log('\n3. Waiting for API calls to complete...');
  await page.waitForTimeout(3000);

  // Extract cookies
  const cookies = await context.cookies();
  findings.cookies = cookies.map(c => ({
    name: c.name,
    value: c.value.substring(0, 50) + '...',
    domain: c.domain,
    httpOnly: c.httpOnly,
    secure: c.secure,
  }));

  console.log('\n4. Extracting storage data...');

  // Extract localStorage - with full token capture
  findings.localStorage = await page.evaluate(() => {
    const items = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      let value = localStorage.getItem(key);
      items[key] = value;
    }
    return items;
  });

  // Look for tokens in localStorage
  Object.entries(findings.localStorage).forEach(([key, value]) => {
    if (typeof value === 'string' && value.includes('eyJ')) {
      console.log(`\n✅ JWT Found in localStorage[${key}]:`);
      console.log(`   ${value.substring(0, 100)}...`);
      if (!findings.tokens.includes(value)) {
        findings.tokens.push(value);
      }
      findings.tokenSources.push({
        url: 'localStorage',
        key,
        status: 'localStorage_jwt',
        timestamp: new Date().toISOString(),
        tokenValue: value,
      });
    }
  });

  // Extract sessionStorage - with full token capture
  findings.sessionStorage = await page.evaluate(() => {
    const items = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      let value = sessionStorage.getItem(key);
      items[key] = value;
    }
    return items;
  });

  // Look for tokens in sessionStorage
  Object.entries(findings.sessionStorage).forEach(([key, value]) => {
    if (typeof value === 'string' && value.includes('eyJ')) {
      console.log(`\n✅ JWT Found in sessionStorage[${key}]:`);
      console.log(`   ${value.substring(0, 100)}...`);
      if (!findings.tokens.includes(value)) {
        findings.tokens.push(value);
      }
      findings.tokenSources.push({
        url: 'sessionStorage',
        key,
        status: 'sessionStorage_jwt',
        timestamp: new Date().toISOString(),
        tokenValue: value,
      });
    }
  });

  // Try to get API response manually
  console.log('\n5. Making API test call...');
  try {
    const response = await page.evaluate(async () => {
      const res = await fetch('https://www.producer.ai/__api/v2/users/me');
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
      };
    });
    findings.apiTestCall = response;
  } catch (e) {
    console.log('⚠️  API test call failed');
  }

  // Display findings
  console.log('\n' + '='.repeat(80));
  console.log('🔎 AUTHENTICATION INVESTIGATION FINDINGS');
  console.log('='.repeat(80));

  console.log('\n📍 Auth Mechanism Detected:', findings.authMechanism || 'Bearer Token (JWT)');

  if (findings.tokenSources.length > 0) {
    console.log(`\n🔑 Token Sources (${findings.tokenSources.length}):`);
    findings.tokenSources.forEach((source, i) => {
      console.log(`\n   ${i + 1}. Endpoint: ${source.url}`);
      console.log(`      Status: ${source.status}`);
      console.log(`      Response Keys: ${source.responseKeys.join(', ')}`);
      if (source.tokenValue) {
        console.log(`      Token: ${source.tokenValue.substring(0, 80)}...`);
      }
    });
  } else {
    console.log('\n❌ No token response bodies found');
  }

  if (findings.authFlow.length > 0) {
    console.log(`\n📊 Auth Flow Sequence (${findings.authFlow.length} API calls):`);
    console.log('\n   First 10 API calls:');
    findings.authFlow.slice(0, 10).forEach((call, i) => {
      const shortUrl = call.url.length > 70 ? call.url.substring(0, 67) + '...' : call.url;
      console.log(`   ${i + 1}. [${call.status}] ${shortUrl}`);
    });
    if (findings.authFlow.length > 10) {
      console.log(`   ... and ${findings.authFlow.length - 10} more calls`);
    }
  }

  if (findings.tokens.length > 0) {
    console.log(`\n🔐 JWT Tokens Captured (${findings.tokens.length}):`);
    findings.tokens.forEach((token, i) => {
      if (typeof token === 'string') {
        console.log(`   ${i + 1}. ${token.substring(0, 80)}...`);
      }
    });
  } else {
    console.log('\n❌ No JWT tokens found in responses');
  }

  if (Object.keys(findings.localStorage).length > 0) {
    console.log('\n💾 LocalStorage Keys:');
    Object.keys(findings.localStorage).forEach(key => {
      console.log(`   - ${key}`);
    });
  }

  if (findings.cookies.length > 0) {
    console.log('\n🍪 Cookies Found:');
    findings.cookies.forEach(c => {
      console.log(`   - ${c.name} (${c.domain})`);
    });
  }

  console.log('\n📊 API Requests Intercepted:', findings.requests.length);
  console.log('   Authorization headers found:', findings.tokens.length);

  // Save findings to file
  const filename = 'auth-investigation-findings.json';
  fs.writeFileSync(filename, JSON.stringify(findings, null, 2));
  console.log(`\n✅ Detailed findings saved to: ${filename}`);

  await browser.close();
}

investigate().catch(console.error);

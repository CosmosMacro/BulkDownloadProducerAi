import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

/**
 * Discord OAuth Authentication via Playwright
 * Flow: producer.ai → Discord OAuth → Supabase JWT Token
 */

export async function discordAuth(options = {}) {
  const {
    headless = false,
    timeout = 120000,
    saveToConfig = false,
    configPath = 'config.json',
  } = options;

  let browser;
  let capturedToken = null;

  try {
    console.log('🔐 Starting Discord authentication...');
    console.log('   Launching Chromium browser');

    browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Intercept all requests to capture Bearer token
    page.on('request', request => {
      const headers = request.headers();
      if (headers['authorization'] && headers['authorization'].startsWith('Bearer ')) {
        capturedToken = headers['authorization'].replace('Bearer ', '');
        console.log(`✅ JWT Token captured from request: ${capturedToken.substring(0, 50)}...`);
      }
    });

    // Navigate to producer.ai
    console.log('📍 Navigating to producer.ai');
    try {
      await page.goto('https://www.producer.ai', { waitUntil: 'networkidle', timeout: 10000 });
    } catch (e) {
      console.log('⚠️  Navigation timeout (expected during auth flow)');
    }

    // Wait for Discord OAuth to complete
    console.log('\n🔗 Waiting for Discord OAuth flow...');
    console.log('   Please complete the login in the browser window\n');

    // Wait for token capture or timeout
    const startTime = Date.now();
    while (!capturedToken && Date.now() - startTime < timeout) {
      await page.waitForTimeout(1000);
    }

    if (!capturedToken) {
      // Try extracting from localStorage/cookies as fallback
      console.log('⚠️  No token in request headers, checking storage...');
      capturedToken = await extractTokenFromStorage(page);
    }

    if (!capturedToken) {
      throw new Error('Failed to capture JWT token from Discord OAuth');
    }

    console.log('\n✅ Authentication successful!');
    console.log(`🔑 Token: ${capturedToken.substring(0, 80)}...`);

    // Get user ID from API call
    console.log('\n📊 Fetching user information...');
    const userId = await fetchUserId(page, capturedToken);
    console.log(`👤 User ID: ${userId}`);

    // Save to config if requested
    if (saveToConfig) {
      console.log(`\n💾 Saving configuration to ${configPath}`);
      const config = {
        token: capturedToken,
        userId,
        outputDir: './downloads',
        format: 'mp3',
        authMethod: 'discord',
        authenticatedAt: new Date().toISOString(),
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('✅ Configuration saved');
    }

    return {
      token: capturedToken,
      userId,
      expiresAt: null, // TODO: Extract from JWT or API response
    };
  } catch (error) {
    console.error('\n❌ Authentication failed:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('\n🔒 Browser closed');
    }
  }
}

/**
 * Extract token from localStorage or cookies
 */
async function extractTokenFromStorage(page) {
  try {
    // Check localStorage for JWT (starts with "eyJ")
    const localStorageData = await page.evaluate(() => {
      const items = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        if (value && value.includes('eyJ')) {
          items[key] = value;
        }
      }
      return items;
    });

    for (const [key, value] of Object.entries(localStorageData)) {
      if (value.startsWith('eyJ')) {
        console.log(`   Found JWT in localStorage[${key}]`);
        return value;
      }
    }

    // Check Supabase auth cookies
    const cookies = await page.context().cookies();
    for (const cookie of cookies) {
      if (cookie.name.startsWith('sb-api-auth-token')) {
        try {
          const data = JSON.parse(cookie.value);
          if (data.access_token) {
            console.log(`   Found token in cookie: ${cookie.name}`);
            return data.access_token;
          }
        } catch (e) {
          // Not JSON, skip
        }
      }
    }

    return null;
  } catch (error) {
    console.error('   Error extracting from storage:', error.message);
    return null;
  }
}

/**
 * Fetch user ID from API
 */
async function fetchUserId(page, token) {
  try {
    const response = await page.evaluate(async (bearerToken) => {
      const res = await fetch('https://www.producer.ai/__api/v2/users/me', {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
        },
      });
      return await res.json();
    }, token);

    if (response.id) {
      return response.id;
    }

    // Try alternative endpoint
    const response2 = await page.evaluate(async (bearerToken) => {
      const res = await fetch('https://www.producer.ai/__api/v2/users', {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
        },
      });
      return await res.json();
    }, token);

    if (response2[0]?.id) {
      return response2[0].id;
    }

    return 'unknown';
  } catch (error) {
    console.error('   Error fetching user ID:', error.message);
    return 'unknown';
  }
}

/**
 * Validate existing token
 */
export async function validateToken(token) {
  try {
    const response = await fetch('https://www.producer.ai/__api/v2/users/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.status === 200) {
      const user = await response.json();
      console.log(`✅ Token valid for user: ${user.id || 'unknown'}`);
      return true;
    } else if (response.status === 401) {
      console.log('❌ Token expired or invalid');
      return false;
    }

    return false;
  } catch (error) {
    console.error('❌ Token validation failed:', error.message);
    return false;
  }
}

/**
 * Load config and validate token
 */
export async function loadConfig(configPath = 'config.json') {
  try {
    if (!fs.existsSync(configPath)) {
      console.log(`⚠️  Config file not found: ${configPath}`);
      return null;
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Validate token
    console.log('🔍 Validating stored token...');
    const isValid = await validateToken(config.token);

    if (!isValid) {
      console.log('⚠️  Stored token is invalid, need re-authentication');
      return null;
    }

    console.log(`✅ Config loaded for user: ${config.userId}`);
    return config;
  } catch (error) {
    console.error('❌ Error loading config:', error.message);
    return null;
  }
}

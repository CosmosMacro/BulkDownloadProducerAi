/**
 * Producer.ai API Communication
 */

export async function fetchGenerations(token, userId, offset = 0, limit = 20) {
  const url = `https://www.producer.ai/__api/v2/users/${userId}/generations?offset=${offset}&limit=${limit}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

export function getDownloadUrl(generationId, format = 'mp3') {
  return `https://www.producer.ai/__api/${generationId}/download?format=${format}`;
}

export async function getUserInfo(token) {
  const response = await fetch('https://www.producer.ai/__api/v2/users/me', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return await response.json();
}

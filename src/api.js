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
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return await response.json();
}

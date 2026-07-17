export async function searchLocalMemory(context, body) {
  const v3 = await postJson(context.fetch, `${context.baseUrl}/v3/search`, body);
  if (hasResults(v3)) {
    return { ...v3, route: "/v3/search", fallbackUsed: false, primary: v3 };
  }

  const v4 = await postJson(context.fetch, `${context.baseUrl}/v4/search`, body);
  if (hasResults(v4)) {
    return { ...v4, route: "/v4/search", fallbackUsed: true, primary: v3 };
  }

  return {
    ...v3,
    route: "/v3/search",
    fallbackUsed: false,
    fallback: v4,
    primary: v3
  };
}

export function searchIncludes(response, value) {
  return response.ok && JSON.stringify(response.body ?? {}).includes(value);
}

export function responseDetail(response) {
  if (response.error) return response.error;
  if (response.status) return `HTTP ${response.status}: ${JSON.stringify(response.body)}`;
  return "No response";
}

async function postJson(fetchFn, url, body) {
  return requestJson(fetchFn, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function requestJson(fetchFn, url, init) {
  try {
    const response = await fetchFn(url, {
      ...init,
      signal: AbortSignal.timeout(5000)
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text ? JSON.parse(text) : null,
      text
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      text: "",
      error: formatFetchError(error)
    };
  }
}

function hasResults(response) {
  if (!response.ok) return false;
  const results = response.body?.results;
  if (Array.isArray(results)) return results.length > 0;
  return Number(response.body?.total ?? 0) > 0;
}

function formatFetchError(error) {
  const cause = error.cause;
  if (cause?.code) {
    return `${error.message}: ${cause.code}`;
  }
  return error.message;
}

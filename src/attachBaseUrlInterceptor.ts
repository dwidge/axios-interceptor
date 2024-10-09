// Copyright DWJ 2024.
// Distributed under the Boost Software License, Version 1.0.
// https://www.boost.org/LICENSE_1_0.txt

import axios, { AxiosInstance, AxiosError } from "axios";

interface BaseUrlCache {
  url: string;
  expiry: number;
}

export function attachBaseUrlInterceptor(
  axiosInstance: AxiosInstance,
): AxiosInstance {
  let baseUrlCache: BaseUrlCache | null = null;
  const CACHE_DURATION_MS = 2 * 60 * 1000; // 2 minutes

  const parseBaseUrls = (baseURL: string): string[] => {
    return baseURL.split(",").map((url) => url.trim());
  };

  const pingUrls = async (urls: string[]): Promise<string> => {
    const pingPromises = urls.map((url) =>
      axios
        .get(url, { timeout: 5000 }) // timeout of 5 seconds per ping
        .then(() => url),
    );

    try {
      return await Promise.any(pingPromises);
    } catch (error) {
      throw new Error(`attachBaseUrlInterceptorE1: ${error}`);
    }
  };

  const selectBaseUrl = async (baseURL: string): Promise<string> => {
    const urls = parseBaseUrls(baseURL);

    if (!baseUrlCache || Date.now() > baseUrlCache.expiry) {
      const fastestUrl = await pingUrls(urls);
      baseUrlCache = {
        url: fastestUrl,
        expiry: Date.now() + CACHE_DURATION_MS,
      };
      return fastestUrl;
    }

    return baseUrlCache.url;
  };

  axiosInstance.interceptors.request.use(
    async (config) => {
      if (!config.baseURL || !config.baseURL.includes(",")) {
        return config; // If no comma-separated baseURL is found, proceed normally
      }

      try {
        const selectedBaseUrl = await selectBaseUrl(config.baseURL);
        return {
          ...config, // Create a new config object using the spread operator
          baseURL: selectedBaseUrl,
        };
      } catch (error) {
        return Promise.reject(error);
      }
    },
    (error) => {
      return Promise.reject(error);
    },
  );

  axiosInstance.interceptors.response.use(
    (response) => {
      return response;
    },
    async (error: AxiosError) => {
      if (
        error.config &&
        error.config.baseURL &&
        error.code === "ECONNABORTED"
      ) {
        // Retry the ping check if a request has timed out
        baseUrlCache = null; // Clear cache to force a new ping check
        try {
          const selectedBaseUrl = await selectBaseUrl(error.config.baseURL);
          const newConfig = {
            ...error.config, // Create a new config object using the spread operator
            baseURL: selectedBaseUrl,
          };
          return axiosInstance.request(newConfig); // Retry the request with the new baseURL
        } catch (pingError) {
          return Promise.reject(pingError);
        }
      }
      return Promise.reject(error);
    },
  );

  return axiosInstance;
}

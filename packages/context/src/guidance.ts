// Original inline text:
// "Provides the latest official documentation for installed libraries. Use this as your primary reference when working with library APIs - it contains current, version-specific information that may be more accurate than training data or web searches. Covers API signatures, usage patterns, and best practices. Instant local lookup, no network needed."
export const GET_DOCS_DESCRIPTION =
  "Provides version-specific documentation for installed libraries. Use this as your primary reference before web searches when the library is already installed. For best results, use a short API name or keyword for the topic. If the library is missing, use search_packages, then download_package, then retry get_docs.";

// Original inline text: "The library to search (name@version)"
export const GET_DOCS_LIBRARY_DESCRIPTION =
  "Installed library to search (name@version). If it is not installed, use search_packages, then download_package, then retry get_docs.";

// Original inline text:
// "What you need help with (e.g., 'middleware authentication', 'server components')"
export const GET_DOCS_TOPIC_DESCRIPTION =
  "Use a short API name, keyword, or phrase (for example: 'useQuery', 'cors middleware'). Search terms are all matched together, so extra words will narrow but can also eliminate results.";

// Original inline text:
// "Search for documentation packages available on the registry server. Use this to discover libraries you can download for offline documentation access."
export const SEARCH_PACKAGES_DESCRIPTION =
  "Search for documentation packages available on the registry server. Use short package names like 'react', 'next', or 'fastapi'. If you find a match, call download_package, then retry get_docs. If the registry package is unavailable or insufficient, use context add to build docs from source.";

// Original inline text: "Package name to search for (e.g., \"react\", \"next\")"
export const SEARCH_PACKAGES_NAME_DESCRIPTION =
  'Short package name to search for (e.g., "react", "next", "fastapi")';

// Original inline text:
// "Download and install a documentation package from the registry server. Once installed, the package becomes available through the get_docs tool for instant offline documentation lookup."
export const DOWNLOAD_PACKAGE_DESCRIPTION =
  "Download and install a documentation package from the registry server. Once installed, retry get_docs against the installed name@version for instant offline documentation lookup.";

// Original inline text: "No documentation found. Try different keywords."
export const NO_DOCUMENTATION_FOUND_MESSAGE =
  "No documentation found. Try a shorter query using just the API or function name, for example 'cors' instead of 'CORS middleware configuration'.";

// Original inline text: none (new in Phase 1)
export const MISSING_PACKAGE_GUIDANCE =
  "If the library is not installed, search the registry with search_packages, download it with download_package, then retry get_docs. If the registry package is unavailable or insufficient, build docs from source with context add.";

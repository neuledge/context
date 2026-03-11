export const GET_DOCS_DESCRIPTION =
  "Provides version-specific documentation for installed libraries. Use this as your primary reference before web searches when the library is already installed. For best results, use a short API name or keyword for the topic. If the library is missing, use search_packages, then download_package, then retry get_docs.";

export const GET_DOCS_LIBRARY_DESCRIPTION =
  "Installed library to search (name@version). If it is not installed, use search_packages, then download_package, then retry get_docs.";

export const GET_DOCS_TOPIC_DESCRIPTION =
  "Use a short API name, keyword, or phrase (for example: 'createServer', 'cors middleware'). Search terms are all matched together, so extra words will narrow but can also eliminate results.";

export const SEARCH_PACKAGES_DESCRIPTION =
  "Search for documentation packages available on the registry server. Use short package names like 'react', 'next', or 'fastapi'. If you find a match, call download_package, then retry get_docs. If the registry package is unavailable or insufficient, ask the user to run `context add` to build docs from source.";

export const SEARCH_PACKAGES_NAME_DESCRIPTION =
  'Short package name to search for (e.g., "react", "next", "fastapi")';

export const DOWNLOAD_PACKAGE_DESCRIPTION =
  "Download and install a documentation package from the registry server. Once installed, retry get_docs against the installed name@version for instant offline documentation lookup.";

export const NO_DOCUMENTATION_FOUND_MESSAGE =
  "No documentation found. Try a shorter query using just the API or function name, for example 'cors' instead of 'CORS middleware configuration'.";

export const MISSING_PACKAGE_GUIDANCE =
  "If the library is not installed, search the registry with search_packages, download it with download_package, then retry get_docs. If the registry package is unavailable or insufficient, ask the user to run `context add` to build docs from source.";

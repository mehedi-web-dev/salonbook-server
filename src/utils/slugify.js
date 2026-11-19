/**
 * Generates a URL-friendly slug from a text string.
 * Converts to lowercase, normalizes accents, turns spaces and underscores
 * into hyphens, and removes non-alphanumeric characters.
 *
 * @param {string} text - The input string to slugify.
 * @returns {string} The URL-friendly slug.
 */
export const slugify = (text) => {
  if (!text || typeof text !== "string") {
    return "";
  }

  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[\s_]+/g, "-") // Convert whitespace and underscores to hyphens
    .replace(/[^a-z0-9-]/g, "") // Remove any non-alphanumeric characters except hyphens
    .replace(/-+/g, "-") // Collapse multiple consecutive hyphens
    .replace(/^-+|-+$/g, ""); // Trim leading and trailing hyphens
};

export default slugify;

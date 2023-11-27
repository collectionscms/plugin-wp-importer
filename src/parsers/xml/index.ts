import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { convert } from "html-to-text";
import DOMPurify from "isomorphic-dompurify";
import { NodeHtmlMarkdown } from "node-html-markdown";
import xml2js from "xml2js";

dayjs.extend(utc);

type Category = {
  id: number;
  slug: string;
  name: string;
};

type Tag = {
  id: number;
  slug: string;
  name: string;
};

type Post = {
  id: number;
  title: string;
  content: string;
  contentText: string;
  status: statusMap;
  slug: string | null;
  isPage: boolean;
  publishedDate: Date | null;
  categories: Category[];
  tags: Tag[];
  createdAt: Date;
  updatedAt: Date;
};

enum statusMap {
  publish = "published",
  draft = "draft",
}

export type WordpressContent = {
  title: string | null;
  categories: Category[];
  tags: Tag[];
  posts: Post[];
};

/**
 * @description Parse WordPress XML file to Wordpress Content
 * @param fileData
 * @returns content data
 */
export const parseFromFile = async (
  fileData: string
): Promise<WordpressContent> => {
  const parser = new xml2js.Parser();
  const converter = new NodeHtmlMarkdown();

  const data: WordpressContent = {
    title: null,
    categories: [],
    tags: [],
    posts: [],
  };
  const categories: Category[] = [];
  const tags: Tag[] = [];
  const posts: Post[] = [];

  const slugs: Record<string, string> = {};
  var slugToCategory: Record<string, Category> = {};
  var slugToTag: Record<string, Tag> = {};

  const treatHtml = (html: string) => {
    html = html.replace(/\r\n/g, "\n");
    html = html.replace(/\r/g, "\n");
    html = html.replace(
      /\[((source)?code)[^\]]*\]\n*([\s\S]*?)\n*\[\/\1\]/g,
      "<pre><code>$3</code></pre>"
    );
    html = html.replace(/\[caption.+\](.+)\[\/caption\]/g, "$1");
    html = html.replace(/\[audio\s(.+)\]/g, reformatAudioShortCode);
    html = html.replace(/\[video\s(.+)\]/g, reformatVideoShortCode);
    html = html.replace(/\n\n/g, "<p>");
    html = html.replace(/<pre>(.*?)<\/pre>/g, (match) => {
      return match.replace(/<p>/g, "\n\n");
    });
    html = html.replace(/<p><pre>/g, "<pre>");
    return DOMPurify.sanitize(html);
  };

  const reformatAudioShortCode = (html: string) => {
    const sources = html
      .match(/["'](.+?)["']/g)
      ?.map((source) => {
        return "<source src=" + source + ">";
      })
      ?.join("");
    return "<audio controls>" + sources + "</audio>";
  };

  const reformatVideoShortCode = (html: string) => {
    const sources = html
      .match(/"(.+?)"/g)
      ?.map((source) => {
        return (
          "<source src=" +
          source +
          ' type="video/' +
          source?.match(/['"](.*)\.([^.]*)['"]$/)?.[2] +
          '">'
        );
      })
      ?.join("");
    return "<video controls>" + sources + "</video>";
  };

  const convertHtmlToMarkdown = (html: string) => {
    return converter.translate(html);
  };

  const parseCategories = (items: any[]): Category[] => {
    const categories: Category[] = [];

    for (const item of items) {
      const category = {
        id: parseInt(item["wp:term_id"], 10),
        slug: item["wp:category_nicename"][0],
        name: item["wp:cat_name"][0],
      };
      categories.push(category);
      slugToCategory[category.slug] = category;
    }

    return categories;
  };

  const parseTags = (items: any[]): Tag[] => {
    const tags: Tag[] = [];

    for (const item of items) {
      const tag = {
        id: parseInt(item["wp:term_id"], 10),
        slug: item["wp:tag_slug"][0],
        name: item["wp:tag_name"][0],
      };
      tags.push(tag);
      slugToTag[tag.slug] = tag;
    }

    return tags;
  };

  const result = await parser.parseStringPromise(fileData);
  const channel = result.rss.channel[0];

  // /////////////////////////////////////
  // Site Title
  // /////////////////////////////////////

  data["title"] = channel.title[0];

  // /////////////////////////////////////
  // Category
  // /////////////////////////////////////

  const parsedCategories = parseCategories(channel["wp:category"]);
  categories.push(...parsedCategories);

  // /////////////////////////////////////
  // Tag
  // /////////////////////////////////////

  const parsedTags = parseTags(channel["wp:tag"]);
  tags.push(...parsedTags);

  // /////////////////////////////////////
  // Post
  // /////////////////////////////////////

  for (const item of result.rss.channel[0].item) {
    const postType = item["wp:post_type"][0];
    if (postType !== "post" && postType !== "page") continue;

    const post = {
      id: parseInt(item["wp:post_id"], 10),
      isPage: postType === "page",
    };

    // /////////////////////////////////////
    // Title
    // /////////////////////////////////////

    const title = item.title[0] || "Untitled post";

    // /////////////////////////////////////
    // Content
    // /////////////////////////////////////

    const contentHtml = treatHtml(item["content:encoded"][0]);
    const content = convertHtmlToMarkdown(contentHtml);
    const contentText = convert(contentHtml).replace(/\n/g, " ");

    // /////////////////////////////////////
    // Status
    // /////////////////////////////////////

    const status =
      item["wp:status"] in statusMap
        ? statusMap[item["wp:status"] as keyof typeof statusMap]
        : statusMap.draft;

    // /////////////////////////////////////
    // Post Date
    // /////////////////////////////////////

    // if post_date_gmt is undefined or 0000 then we check post_date in hope of finding a better date.
    // if post_date is undefined, set the current date and time.
    var gmt = item["wp:post_date_gmt"][0];
    if (gmt === undefined || gmt === "0000-00-00 00:00:00") {
      gmt = item["wp:post_date"];
    }

    const postDate = dayjs.utc(gmt, "YYYY-MM-DD HH:mm:ss").toDate();

    // /////////////////////////////////////
    // Modified Date
    // /////////////////////////////////////

    var gmt = item["wp:post_modified_gmt"][0];
    if (gmt === undefined || gmt === "0000-00-00 00:00:00") {
      gmt = item["wp:post_modified"];
    }

    const modifiedDate = dayjs.utc(gmt, "YYYY-MM-DD HH:mm:ss").toDate();

    // /////////////////////////////////////
    // Publish Date
    // /////////////////////////////////////

    const pubDate = item["pubDate"] ? dayjs(item["pubDate"]).toDate() : null;

    // /////////////////////////////////////
    // Slug
    // /////////////////////////////////////

    // This can happen because WP allows posts to share slugs...
    let slug = item["wp:post_name"][0] || title;
    if (slug in slugs) {
      let renamingSlug = title;
      if (renamingSlug === "" || renamingSlug in slugs) {
        let n = 2;
        renamingSlug = renamingSlug.replace(/-\d*$/, "");
        while (renamingSlug + "-" + n in slugs) {
          n++;
        }
        renamingSlug = renamingSlug + "-" + n;
      }
      slug = renamingSlug;
    }
    slugs[slug] = slug;

    // /////////////////////////////////////
    // Post Tags / Categories
    // /////////////////////////////////////

    const postCategories: Category[] = [];
    const postTags: Tag[] = [];

    if (typeof item.category !== "undefined") {
      for (var i = 0; i < item.category.length; i++) {
        if (!item.category[i].$) continue;

        const slug = item.category[i].$.nicename;
        const domain = item.category[i].$.domain;

        switch (domain) {
          case "category":
            const category = slugToCategory[slug];
            if (
              postCategories.some(
                (postCategory) => postCategory.id === category.id
              )
            )
              continue;
            postCategories.push(category);
            break;
          case "post_tag":
            const tag = slugToTag[slug];
            if (postTags.some((postTag) => postTag.id === tag.id)) continue;
            postTags.push(tag);
            break;
        }
      }
    }

    posts.push({
      ...post,
      title,
      status,
      content,
      contentText,
      slug: slug,
      publishedDate: pubDate,
      categories: postCategories,
      tags: postTags,
      createdAt: postDate,
      updatedAt: modifiedDate,
    });
  }

  return {
    ...data,
    categories,
    tags,
    posts,
  };
};

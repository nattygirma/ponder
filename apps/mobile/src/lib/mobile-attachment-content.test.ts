import { describe, expect, test } from "bun:test";
import {
  getMobileAttachmentLinkClass,
  resolveMobileAttachmentContent,
} from "./mobile-attachment-content";

describe("resolveMobileAttachmentContent", () => {
  test("converts PDF and file attachment nodes into mobile-safe links", () => {
    expect(resolveMobileAttachmentContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{
            type: "ponderPdfAttachment",
            attrs: {
              url: "/api/v1/resources/res_pdf/blob",
              label: "附件：报告.pdf",
              filename: "报告.pdf",
              mimeType: "application/pdf",
              byteSize: 12582912,
              displayMode: "compact",
            },
          }],
        },
        {
          type: "paragraph",
          content: [{
            type: "ponderFileAttachment",
            attrs: {
              url: "/api/v1/resources/res_doc/blob",
              label: "附件：说明.docx",
              filename: "说明.docx",
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              byteSize: 856000,
            },
          }],
        },
      ],
    })).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{
            type: "text",
            text: "附件：报告.pdf",
            marks: [{
              type: "link",
              attrs: {
                href: "/api/v1/resources/res_pdf/blob",
                target: "_blank",
                class: "ponder-attachment-link ponder-attachment-kind-pdf",
                attachmentFilename: "报告.pdf",
                attachmentMimeType: "application/pdf",
                attachmentByteSize: 12582912,
              },
            }],
          }],
        },
        {
          type: "paragraph",
          content: [{
            type: "text",
            text: "附件：说明.docx",
            marks: [{
              type: "link",
              attrs: {
                href: "/api/v1/resources/res_doc/blob",
                target: "_blank",
                class: "ponder-attachment-link ponder-attachment-kind-document",
                attachmentFilename: "说明.docx",
                attachmentMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                attachmentByteSize: 856000,
              },
            }],
          }],
        },
      ],
    });
  });

  test("adds type classes to existing resource links and preserves custom classes", () => {
    const result = resolveMobileAttachmentContent({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "附件：数据.xlsx",
          marks: [{
            type: "link",
            attrs: {
              href: "/api/v1/resources/res_sheet/blob",
              class: "custom ponder-attachment-link ponder-attachment-kind-file",
            },
          }],
        }],
      }],
    });

    expect(result.content[0]?.content?.[0]).toMatchObject({
      marks: [{
        attrs: {
          class: "custom ponder-attachment-link ponder-attachment-kind-spreadsheet",
        },
      }],
    });
    expect(getMobileAttachmentLinkClass("演示.pptx")).toContain("ponder-attachment-kind-presentation");
  });

  test("preserves surrounding rich content and falls back for incomplete nodes", () => {
    const originalParagraph = {
      type: "paragraph",
      content: [{ type: "text", text: "Body", marks: [{ type: "bold" }] }],
    };
    const result = resolveMobileAttachmentContent({
      type: "doc",
      content: [
        originalParagraph,
        {
          type: "paragraph",
          content: [{
            type: "ponderFileAttachment",
            attrs: { filename: "fallback.zip" },
          }],
        },
      ],
    });

    expect(result.content[0]).toEqual(originalParagraph);
    expect(result.content[1]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "fallback.zip" }],
    });
  });
});

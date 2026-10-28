export const userPublicSelect = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const postWithAuthorInclude = {
  author: {
    select: userPublicSelect,
  },
} as const;

export class PostEntity {
  id: number;
  title: string;
  content: string;
  published: boolean;
  authorId: number;
  author?: {
    id: number;
    email: string;
    name: string | null;
  };
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<PostEntity>) {
    Object.assign(this, partial);
  }
}

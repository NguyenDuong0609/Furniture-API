import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class MediaService {
  private readonly uploadPath: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadPath = path.join(process.cwd(), 'uploads');
    this.baseUrl =
      this.configService.get('APP_URL') || 'http://localhost:3000';
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: 'products' | 'avatars' = 'products',
  ) {
    if (!file) {
      throw new BadRequestException('Không có file được upload');
    }

    // Validate loại file
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Chỉ chấp nhận file ảnh (jpg, png, webp, gif)');
    }

    // Validate kích thước (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('File không được vượt quá 5MB');
    }

    const folderPath = path.join(this.uploadPath, folder);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const ext = path.extname(file.originalname);
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(folderPath, filename);

    // Lưu file
    fs.writeFileSync(filePath, file.buffer);

    const url = `${this.baseUrl}/uploads/${folder}/${filename}`;

    return {
      url,
      filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  async deleteFile(fileUrl: string) {
    try {
      const relativePath = fileUrl.replace(this.baseUrl + '/', '');
      const fullPath = path.join(process.cwd(), relativePath);

      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (error) {
      // bỏ qua lỗi xóa file
    }
  }
}
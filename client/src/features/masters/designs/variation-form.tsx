import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { normalizeCode, variationCode, type Design, type UploadResult } from '@rivoora/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ImageThumb } from '@/components/ui/image-thumb';
import { ImageDropzone, ImagePickButton } from '@/components/ui/image-upload';
import { Input } from '@/components/ui/input';
import { ResponsiveModal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api';
import { applyServerFieldError } from '@/lib/form';
import { useAddVariation } from '../api';
import { designCodeField, useCodeAvailability } from './design-form';

const schema = z.object({ code: designCodeField });
type FormValues = z.infer<typeof schema>;

interface VariationFormDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  design: Design;
}

/** Add a variation: image + a code the user types in (not generated). */
export function VariationFormDialog({ open, onOpenChange, design }: VariationFormDialogProps) {
  const add = useAddVariation(design.id);
  const [image, setImage] = useState<UploadResult | null>(null);
  const [imageError, setImageError] = useState<string>();
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { code: '' } });
  const code = useWatch({ control, name: 'code' });
  const codeCheck = useCodeAvailability(code, open);

  useEffect(() => {
    if (!open) return;
    reset({ code: '' });
    setImage(null);
    setImageError(undefined);
  }, [open, reset]);

  const nextNo = Math.max(0, ...design.variations.map((v) => v.variationNo)) + 1;

  const onSubmit = handleSubmit((values) => {
    if (!image) {
      setImageError('Upload the variation image');
      return;
    }
    if (codeCheck.data?.available === false) {
      setError('code', { message: 'This code is already used' }, { shouldFocus: true });
      return;
    }
    add.mutate(
      { code: values.code, imageUrl: image.url, thumbUrl: image.thumbUrl },
      {
        onSuccess: (v) => {
          toast.success(`Variation ${v.code} added`);
          onOpenChange(false);
        },
        onError: (err) => {
          if (!applyServerFieldError(err, setError, ['code'])) toast.error(errorMessage(err));
        },
      },
    );
  });

  const pickImage = (img: UploadResult) => {
    setImage(img);
    setImageError(undefined);
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !add.isPending && onOpenChange(o)}
      title={`Add variation · ${design.code}`}
      size="lg"
      mobileVariant="fullscreen"
      dismissible={!isDirty && !image}
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={add.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="variation-form" loading={add.isPending}>
            Save variation
          </Button>
        </div>
      }
    >
      <form id="variation-form" onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-[220px_1fr]">
        <Field label="Variation image" required error={imageError}>
          {image ? (
            <div className="space-y-2">
              <ImageThumb thumbUrl={image.thumbUrl} fullUrl={image.url} alt="Variation image" className="aspect-square w-full" rounded="rounded-xl" />
              <ImagePickButton folder="designs" onUploaded={pickImage} className="w-full">
                <RefreshCw /> Change image
              </ImagePickButton>
            </div>
          ) : (
            <ImageDropzone folder="designs" onUploaded={pickImage} hint="JPG, PNG or WebP · up to 10 MB" className="[&_button]:aspect-square" />
          )}
        </Field>
        <div className="grid content-start gap-4">
          <Field
            label="Variation code"
            htmlFor="v-code"
            required
            error={errors.code?.message}
            hint={
              codeCheck.data ? (
                codeCheck.data.available ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="size-3.5" /> {normalizeCode(code)} is available
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <XCircle className="size-3.5" /> This code is already used
                  </span>
                )
              ) : (
                'Must be unique across all designs and variations'
              )
            }
          >
            <Input
              id="v-code"
              autoFocus
              className="uppercase"
              autoComplete="off"
              placeholder={`e.g. ${variationCode(design.code, nextNo)}`}
              invalid={!!errors.code || codeCheck.data?.available === false}
              {...register('code')}
            />
          </Field>
        </div>
      </form>
    </ResponsiveModal>
  );
}

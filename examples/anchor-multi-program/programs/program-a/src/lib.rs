use anchor_lang::prelude::*;

declare_id!("ALkpavDZFcbRNjZn8cf3ptLfT9DSYQ3hkKBxeZPAXYz2");

#[program]
pub mod program_a {
    use anchor_lang::solana_program::{instruction::Instruction, program::invoke};

    use super::*;

    pub fn cpi(ctx: Context<Cpi>) -> Result<()> {
        msg!("Hello from program A: {:?}", ctx.program_id);

        // This is the 8 byte discriminator for the `initialize` method in program B
        let program_b_discriminator = vec![175, 175, 109, 31, 13, 152, 155, 237];

        let account_infos = [
            // ctx.accounts.signer.to_account_info(),
            ctx.accounts.program_b.to_account_info(),
            // ctx.accounts.system_program.to_account_info(),
        ];

        let program_b_ix = Instruction {
            program_id: ctx.accounts.program_b.key(),
            accounts: vec![
                // AccountMeta::new(ctx.accounts.signer.key(), true),
                AccountMeta::new(ctx.accounts.program_b.key(), false),
                // AccountMeta::new_readonly(system_program::ID, false),
            ],
            data: program_b_discriminator,
        };
        
        // no signing here
        invoke(&program_b_ix, &account_infos)?;
        // msg!("INVOKE HERE");
        Ok(())
    }

    pub fn non_cpi(ctx: Context<NonCpi>) -> Result<()> {
        msg!("Hello from program A non-cpi: {:?}", ctx.program_id);
        let x: u64 = 1;
        let y: u64 = 2;
        let sum = x.checked_add(y).unwrap();
        msg!("The sum of {} + {} = {}", x, y, sum);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Cpi<'info> {
    // #[account(mut)]
    // pub signer: Signer<'info>,
    /// CHECK: This PDA is derived deterministically using seeds and verified by Anchor's constraints
    #[account(mut)]
    pub program_b: UncheckedAccount<'info>, // Here i receive the programB ID as an account and i use that ID to perform the CPI to it
                                            // pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct NonCpi {}
